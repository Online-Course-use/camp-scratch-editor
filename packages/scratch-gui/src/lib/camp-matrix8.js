/* eslint-disable */
// 營隊自己撰寫的程式（2026-11），格式與註解風格不套用上游的 lint 規則。
/**
 * 8×8 LED 矩陣欄位（Arduino 擴展「LED 矩陣顯示圖案」用）：積木上顯示縮圖，點一下展開 8×8 格子，
 * 點選或拖曳畫圖案，下方兩個按鈕是「全滅」「全亮」。
 *
 * 改寫自 scratch-blocks 2.1.19 的 src/fields/field_matrix.ts（5×5，micro:bit 用；
 * Copyright 2016 Massachusetts Institute of Technology，Apache License 2.0），
 * 營隊於 2026-11 改為 8×8、修正格子座標計算、改成獨立的欄位與 shadow 積木。
 *
 * 注意：自訂的方法一律加 camp 前綴。Blockly 的 Field 本身有 onMouseDown_ 等方法（點欄位時開啟編輯器），
 * 同名會蓋掉它，點縮圖就打不開格子、反而執行整個積木（2026-11-16 使用者實測發現）。
 *
 * 值：64 個 '0'／'1'，每 8 個是一個橫排，由上到下、由左到右（和 scratch-vm
 * scratch3_camparduino/parts.js 的 matrixPattern 一致）。
 */

const SIZE = 8;
const COUNT = SIZE * SIZE;
const ZEROS = '0'.repeat(COUNT);
const ONES = '1'.repeat(COUNT);

const THUMBNAIL_SIZE = 26;
const THUMBNAIL_NODE_SIZE = 2.6;
const THUMBNAIL_NODE_PAD = 0.6;
const ARROW_SIZE = 12;
const NODE_SIZE = 18;
const NODE_RADIUS = 4;
const NODE_PAD = 5;

/**
 * @param {object} ScratchBlocks - require('scratch-blocks')
 */
export default function registerCampMatrix8 (ScratchBlocks) {
    const Blockly = ScratchBlocks;
    if (Blockly.Blocks.camp_matrix8) return;

    class FieldCampMatrix8 extends Blockly.Field {
        constructor (value, validator, config) {
            super(value, validator, config);
            this.SERIALIZABLE = true;
            this.ledThumbNodes_ = [];
            this.ledButtons_ = [];
            this.matrixStage_ = null;
            this.arrow_ = null;
            this.paintStyle_ = null;
            this.wrappers_ = [];
            this.moveWrapper_ = null;
            this.releaseWrapper_ = null;
            this.originalStyle_ = '';
        }

        static fromJson (options) {
            return new FieldCampMatrix8(options.matrix);
        }

        initView () {
            this.updateSize_();
            const arrowPadding = this.getConstants().GRID_UNIT * 2;
            const thumbX = arrowPadding / 2;
            const thumbY = (this.size_.height - THUMBNAIL_SIZE) / 2;
            const thumbnail = Blockly.utils.dom.createSvgElement('g', {
                transform: `translate(${thumbX}, ${thumbY})`,
                'pointer-events': 'bounding-box',
                cursor: 'pointer'
            }, this.fieldGroup_);
            this.ledThumbNodes_ = [];
            const step = THUMBNAIL_NODE_SIZE + THUMBNAIL_NODE_PAD;
            for (let row = 0; row < SIZE; row++) {
                for (let col = 0; col < SIZE; col++) {
                    this.ledThumbNodes_.push(Blockly.utils.dom.createSvgElement('rect', {
                        x: step * col + THUMBNAIL_NODE_PAD,
                        y: step * row + THUMBNAIL_NODE_PAD,
                        width: THUMBNAIL_NODE_SIZE,
                        height: THUMBNAIL_NODE_SIZE,
                        rx: THUMBNAIL_NODE_PAD,
                        ry: THUMBNAIL_NODE_PAD
                    }, thumbnail));
                }
            }
            if (!this.arrow_) {
                const arrowX = THUMBNAIL_SIZE + arrowPadding * 1.5;
                const arrowY = (this.size_.height - ARROW_SIZE) / 2;
                this.arrow_ = Blockly.utils.dom.createSvgElement('image', {
                    height: `${ARROW_SIZE}px`,
                    width: `${ARROW_SIZE}px`,
                    transform: `translate(${arrowX}, ${arrowY})`
                }, this.fieldGroup_);
                this.arrow_.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href',
                    this.getConstants().FIELD_DROPDOWN_SVG_ARROW_DATAURI || '');
                this.arrow_.style.cursor = 'default';
            }
            this.campUpdateMatrix_();
        }

        /** 只留 0／1，補滿或截成 64 個。 */
        doClassValidation_ (value) {
            if (typeof value !== 'string') return null;
            return value.replace(/[^01]/g, '').padEnd(COUNT, '0').slice(0, COUNT);
        }

        doValueUpdate_ (value) {
            super.doValueUpdate_(value);
            if (value) this.campUpdateMatrix_();
        }

        showEditor_ () {
            const block = this.getSourceBlock();
            Blockly.DropDownDiv.setColour(block.getColour(), block.getColourTertiary());
            const style = block.style;
            if (block.isShadow()) {
                this.originalStyle_ = block.getStyleName();
                block.setStyle(`${this.originalStyle_}_selected`);
            } else if (this.borderRect_) {
                this.borderRect_.setAttribute('fill', 'colourQuaternary' in style ? String(style.colourQuaternary) : style.colourTertiary);
            }

            const div = Blockly.DropDownDiv.getContentDiv();
            const stageSize = NODE_SIZE * SIZE + NODE_PAD * (SIZE + 1);
            this.matrixStage_ = Blockly.utils.dom.createSvgElement('svg', {
                xmlns: 'http://www.w3.org/2000/svg',
                version: '1.1',
                height: `${stageSize}px`,
                width: `${stageSize}px`
            }, div);
            this.ledButtons_ = [];
            for (let row = 0; row < SIZE; row++) {
                for (let col = 0; col < SIZE; col++) {
                    this.ledButtons_.push(Blockly.utils.dom.createSvgElement('rect', {
                        x: `${NODE_SIZE * col + NODE_PAD * (col + 1)}px`,
                        y: `${NODE_SIZE * row + NODE_PAD * (row + 1)}px`,
                        width: NODE_SIZE,
                        height: NODE_SIZE,
                        rx: NODE_RADIUS,
                        ry: NODE_RADIUS
                    }, this.matrixStage_));
                }
            }
            const buttonDiv = document.createElement('div');
            const clearDiv = document.createElement('div');
            clearDiv.className = 'scratchMatrixButtonDiv';
            const clearButton = this.campCreateButton_(block.getColourSecondary());
            clearButton.setAttribute('aria-label', '全部熄滅');
            clearDiv.appendChild(clearButton);
            const fillDiv = document.createElement('div');
            fillDiv.className = 'scratchMatrixButtonDiv';
            const fillButton = this.campCreateButton_('var(--colour-text)');
            fillButton.setAttribute('aria-label', '全部點亮');
            fillDiv.appendChild(fillButton);
            buttonDiv.appendChild(clearDiv);
            buttonDiv.appendChild(fillDiv);
            div.appendChild(buttonDiv);

            Blockly.DropDownDiv.showPositionedByBlock(this, block, this.dropdownDispose_.bind(this));

            this.campUnbindEditor_();
            this.wrappers_.push(
                Blockly.browserEvents.bind(this.matrixStage_, 'mousedown', this, this.campPaintStart_.bind(this)),
                Blockly.browserEvents.bind(clearButton, 'click', this, e => {
                    if (e.button === 0) this.setValue(ZEROS);
                }),
                Blockly.browserEvents.bind(fillButton, 'click', this, e => {
                    if (e.button === 0) this.setValue(ONES);
                })
            );
            this.campUpdateMatrix_();
        }

        dropdownDispose_ () {
            const block = this.getSourceBlock();
            if (block && block.isShadow() && this.originalStyle_) block.setStyle(this.originalStyle_);
            this.campUnbindEditor_();
            this.campPaintEnd_();
            this.matrixStage_ = null;
            this.ledButtons_ = [];
            this.campUpdateMatrix_();
        }

        campCreateButton_ (fill) {
            const button = Blockly.utils.dom.createSvgElement('svg', {
                xmlns: 'http://www.w3.org/2000/svg',
                version: '1.1',
                height: `${NODE_SIZE}px`,
                width: `${NODE_SIZE}px`
            });
            const size = NODE_SIZE / 4;
            const pad = NODE_SIZE / 16;
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    Blockly.utils.dom.createSvgElement('rect', {
                        x: (size + pad) * col + pad,
                        y: (size + pad) * row + pad,
                        width: size,
                        height: size,
                        rx: pad,
                        ry: pad,
                        fill
                    }, button);
                }
            }
            return button;
        }

        campUpdateMatrix_ () {
            const value = this.getValue();
            const block = this.getSourceBlock();
            if (!value || !block || !block.getColourTertiary) return;
            for (let i = 0; i < COUNT; i++) {
                const on = value[i] === '1';
                if (this.ledButtons_[i]) this.ledButtons_[i].setAttribute('fill', on ? 'var(--colour-text)' : block.getColourTertiary());
                if (this.ledThumbNodes_[i]) this.ledThumbNodes_[i].setAttribute('fill', on ? 'var(--colour-text)' : block.getColourSecondary());
            }
        }

        campSetLed_ (index, on) {
            const value = this.getValue();
            if (!value || index < 0 || index >= COUNT) return;
            const next = value.slice(0, index) + (on ? '1' : '0') + value.slice(index + 1);
            if (next !== value) this.setValue(next);
        }

        campPaintStart_ (e) {
            this.campPaintEnd_();
            this.moveWrapper_ = Blockly.browserEvents.bind(document.body, 'mousemove', this, this.campPaintMove_.bind(this));
            this.releaseWrapper_ = Blockly.browserEvents.bind(document.body, 'mouseup', this, this.campPaintEnd_.bind(this));
            const index = this.campLedAt_(e);
            if (index < 0) {
                this.paintStyle_ = null;
                return;
            }
            const turnOn = this.getValue()[index] !== '1';
            this.paintStyle_ = turnOn ? 'fill' : 'clear';
            this.campSetLed_(index, turnOn);
        }

        campPaintMove_ (e) {
            e.preventDefault();
            if (!this.paintStyle_) return;
            const index = this.campLedAt_(e);
            if (index >= 0) this.campSetLed_(index, this.paintStyle_ === 'fill');
        }

        campPaintEnd_ () {
            if (this.moveWrapper_) Blockly.browserEvents.unbind(this.moveWrapper_);
            if (this.releaseWrapper_) Blockly.browserEvents.unbind(this.releaseWrapper_);
            this.moveWrapper_ = null;
            this.releaseWrapper_ = null;
            this.paintStyle_ = null;
        }

        /** 滑鼠位置對應到第幾格；不在格子上回傳 -1。 */
        campLedAt_ (e) {
            if (!this.matrixStage_) return -1;
            const box = this.matrixStage_.getBoundingClientRect();
            const dx = e.clientX - box.left - NODE_PAD / 2;
            const dy = e.clientY - box.top - NODE_PAD / 2;
            const step = NODE_SIZE + NODE_PAD;
            const col = Math.floor(dx / step);
            const row = Math.floor(dy / step);
            if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
            return row * SIZE + col;
        }

        campUnbindEditor_ () {
            for (const w of this.wrappers_) Blockly.browserEvents.unbind(w);
            this.wrappers_ = [];
        }

        dispose () {
            this.campUnbindEditor_();
            this.campPaintEnd_();
            this.matrixStage_ = null;
            super.dispose();
        }

        updateSize_ () {
            const constants = this.getConstants();
            this.size_.height = constants.FIELD_TEXT_HEIGHT;
            this.size_.width = THUMBNAIL_SIZE + ARROW_SIZE + constants.GRID_UNIT * 2 * 1.5;
            this.positionBorderRect_();
        }

        getClickTarget_ () {
            return this.getSourceBlock().getSvgRoot();
        }
    }

    Blockly.fieldRegistry.register('field_camp_matrix8', FieldCampMatrix8);

    Blockly.Blocks.camp_matrix8 = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [{type: 'field_camp_matrix8', name: 'MATRIX'}],
                outputShape: Blockly.OUTPUT_SHAPE_ROUND,
                output: 'String',
                extensions: ['colours_pen']
            });
        }
    };
}
