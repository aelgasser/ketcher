var Set = require('../../util/set');
var Vec2 = require('../../util/vec2');
var Action = require('../action');
var HoverHelper = require('./helper/hover');
var EditorTool = require('./base');

var ui = global.ui;

function TemplateTool(editor, tmpl) {
	this.editor = editor;
	this.template = {
		aid: (tmpl.aid || 1) - 1,
		bid: (tmpl.bid || 1) - 1
	};

	var frag = tmpl.struct;
	frag.rescale();

	var xy0 = new Vec2();

	frag.atoms.each(function (aid, atom) {
		xy0.add_(atom.pp); // eslint-disable-line no-underscore-dangle
	});

	this.template.molecule = frag; // preloaded struct
	this.template.xy0 = xy0.scaled(1 / frag.atoms.count()); // template center
	this.template.angle0 = this.calcAngle(frag.atoms.get(this.template.aid).pp, this.template.xy0); // center tilt

	var bond = frag.bonds.get(this.template.bid);
	this.template.sign = this.getSign(frag, bond, this.template.xy0); // template location sign against attachment bond

	this.hoverHelper = new HoverHelper(this);
}
TemplateTool.prototype = new EditorTool();
TemplateTool.prototype.getSign = function (molecule, bond, v) {
	var begin = molecule.atoms.get(bond.begin).pp;
	var end = molecule.atoms.get(bond.end).pp;

	var sign = Vec2.cross(Vec2.diff(begin, end), Vec2.diff(v, end));

	if (sign > 0) return 1;
	if (sign < 0) return -1;
	return 0;
};
TemplateTool.prototype.OnMouseDown = function (event) { // eslint-disable-line max-statements
	var editor = this.editor;
	var rnd = editor.render;
	this.hoverHelper.hover(null);
	this.dragCtx = {
		xy0: rnd.page2obj(event),
		item: editor.findItem(event, ['atoms', 'bonds'])
	};
	var dragCtx = this.dragCtx;
	var ci = dragCtx.item;
	if (!ci || ci.type == 'Canvas') {
		delete dragCtx.item;
	} else if (ci.map == 'bonds') {
		// calculate fragment center
		var molecule = rnd.ctab.molecule;
		var xy0 = new Vec2();
		var bond = molecule.bonds.get(ci.id);
		var frid = rnd.atomGetAttr(bond.begin, 'fragment');
		var frIds = molecule.getFragmentIds(frid);
		var count = 0;

		var loop = molecule.halfBonds.get(bond.hb1).loop;

		if (loop < 0)
			loop = molecule.halfBonds.get(bond.hb2).loop;

		if (loop >= 0) {
			var loopHbs = molecule.loops.get(loop).hbs;
			loopHbs.each(function (hb) {
				xy0.add_(molecule.atoms.get(molecule.halfBonds.get(hb).begin).pp); // eslint-disable-line no-underscore-dangle
				count++;
			});
		} else {
			Set.each(frIds, function (id) {
				xy0.add_(molecule.atoms.get(id).pp); // eslint-disable-line no-underscore-dangle
				count++;
			});
		}

		dragCtx.v0 = xy0.scaled(1 / count);

		var sign = this.getSign(molecule, bond, dragCtx.v0);

		// calculate default template flip
		dragCtx.sign1 = sign || 1;
		dragCtx.sign2 = this.template.sign;
	}
	return true;
};
TemplateTool.prototype.OnMouseMove = function (event) { // eslint-disable-line max-statements
	var editor = this.editor;
	var rnd = editor.render;
	if ('dragCtx' in this) {
		var dragCtx = this.dragCtx;
		var ci = dragCtx.item;
		var pos0;
		var pos1 = rnd.page2obj(event);
		var angle;
		var extraBond;

		dragCtx.mouse_moved = true;

		// calc initial pos and is extra bond needed
		if (!ci || ci.type == 'Canvas') {
			pos0 = dragCtx.xy0;
		} else if (ci.map == 'atoms') {
			pos0 = rnd.atomGetPos(ci.id);
			extraBond = Vec2.dist(pos0, pos1) > 1;
		} else if (ci.map == 'bonds') {
			var molecule = rnd.ctab.molecule;
			var bond = molecule.bonds.get(ci.id);
			var sign = this.getSign(molecule, bond, pos1);

			if (dragCtx.sign1 * this.template.sign > 0)
				sign = -sign;
			if (sign != dragCtx.sign2 || !dragCtx.action) {
				// undo previous action
				if ('action' in dragCtx) dragCtx.action.perform();
				dragCtx.sign2 = sign;
				dragCtx.action = Action.fromTemplateOnBond(ci.id, this.template, this.calcAngle, dragCtx.sign1 * dragCtx.sign2 > 0);
				rnd.update();
			}

			return true;
		}

		angle = this.calcAngle(pos0, pos1);
		var degrees = Math.round(180 / Math.PI * angle);
		// check if anything changed since last time
		if ('angle' in dragCtx && dragCtx.angle == degrees) {
			if ('extra_bond' in dragCtx) {
				if (dragCtx.extra_bond == extraBond)
					return true;
			} else {
				return true;
			}
		}
		// undo previous action
		if ('action' in dragCtx) dragCtx.action.perform();
		// create new action
		dragCtx.angle = degrees;
		if (!ci || ci.type == 'Canvas') {
			dragCtx.action = Action.fromTemplateOnCanvas(
				pos0,
				angle,
				this.template
			);
		} else if (ci.map == 'atoms') {
			dragCtx.action = Action.fromTemplateOnAtom(
				ci.id,
				angle,
				extraBond,
				this.template,
				this.calcAngle
			);
			dragCtx.extra_bond = extraBond;
		}
		rnd.update();
		return true;
	}
	this.hoverHelper.hover(this.editor.findItem(event, ['atoms', 'bonds']));
	return true;
};
TemplateTool.prototype.OnMouseUp = function () { // eslint-disable-line max-statements
	var editor = this.editor;
	var render = editor.render;
	if ('dragCtx' in this) {
		var dragCtx = this.dragCtx;
		var ci = dragCtx.item;

		if (!dragCtx.action) {
			if (!ci || ci.type == 'Canvas') {
				dragCtx.action = Action.fromTemplateOnCanvas(dragCtx.xy0, 0, this.template);
			} else if (ci.map == 'atoms') {
				var degree = render.atomGetDegree(ci.id);

				if (degree > 1) { // common case
					dragCtx.action = Action.fromTemplateOnAtom(
						ci.id,
						null,
						true,
						this.template,
						this.calcAngle
					);
				} else if (degree == 1) { // on chain end
					var molecule = render.ctab.molecule;
					var neiId = molecule.halfBonds.get(molecule.atoms.get(ci.id).neighbors[0]).end;
					var atom = molecule.atoms.get(ci.id);
					var nei = molecule.atoms.get(neiId);

					dragCtx.action = Action.fromTemplateOnAtom(
						ci.id,
					this.calcAngle(nei.pp, atom.pp),
						false,
						this.template,
						this.calcAngle
					);
				} else { // on single atom
					dragCtx.action = Action.fromTemplateOnAtom(
						ci.id,
						0,
						false,
						this.template,
						this.calcAngle
					);
				}
			} else if (ci.map == 'bonds') {
				dragCtx.action = Action.fromTemplateOnBond(ci.id, this.template, this.calcAngle, dragCtx.sign1 * dragCtx.sign2 > 0);
			}

			render.update();
		}

		if ('action' in this.dragCtx) {
			if (!this.dragCtx.action.isDummy())
				ui.addUndoAction(this.dragCtx.action);
		}
		delete this.dragCtx;
	}
};
TemplateTool.prototype.OnCancel = function () {
	this.OnMouseUp(); // eslint-disable-line new-cap
};

module.exports = TemplateTool;
