import { Plugin } from "obsidian";
import { singular } from "pluralize";

// make sure last key pressed is space, make sure the cursor is right after the found one

export default class MyPlugin extends Plugin {
    lastKey: string;

    getBlockIds(inputString: string): string[] {
        return Array.from(inputString.matchAll(/ \^([a-zA-Z0-9-]+$)/gm)).map((match) => match[1]);
    }

    normalizeId(id: string): string {
        return id.replace(/ /g, '-').toLowerCase().split('-').map((word) => singular(word)).join('-');
    }

    onload(): void {
        document.addEventListener('keydown', (event) => {
            this.lastKey = event.key;
        });

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (this.lastKey !== ' ') return;

                const cursorPos = editor.getCursor();
                const originalLine = editor.getLine(cursorPos.line);

                const blockIds = this.getBlockIds(editor.getValue());

                if (blockIds.length === 0) return;

                blockIds.forEach((blockId) => { // loop through each definition in file
                    const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };

                    // text representing the valid text for a blockid directly before the cursor
                    const possibleBlockIdContainingStr = (originalLine.substring(0, cursorPosBeforeSpace.ch).match(/[a-zA-Z0-9- ]+$/) || [''])[0];

                    // number of terms in the block id
                    const numTermsInBlockId = blockId.split(/[ -]/).length;

                    // select text going backwards for the number of terms in the block id
                    const substr = (possibleBlockIdContainingStr.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${numTermsInBlockId}}$`)) || [''])[0].replace(/^[ -]/, '');

                    if (this.normalizeId(substr) === this.normalizeId(blockId)) {
                        editor.replaceRange(`[[#^${blockId}|${substr}]]`, { line: cursorPosBeforeSpace.line, ch: cursorPosBeforeSpace.ch - substr.length }, cursorPosBeforeSpace);
                        return;
                    }
                });
            })
        );
    }
}