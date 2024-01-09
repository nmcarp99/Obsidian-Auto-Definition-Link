import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Plugin, TFile } from "obsidian";
import { singular } from "pluralize";

// make sure last key pressed is space, make sure the cursor is right after the found one

function getBlockIds(inputString: string): string[] {
    return Array.from(inputString.matchAll(/ \^([a-zA-Z0-9-]+$)/gm)).map((match) => match[1]);
}

function normalizeId(id: string): string {
    return id.replace(/ /g, '-').toLowerCase().split('-').map((word) => singular(word)).join('-');
}

type SuggestionData = {
    id: string,
    text: string,
    cursor: EditorPosition,
    numTerms: number,
};

class AutoDefinitionLinkSuggest extends EditorSuggest<SuggestionData> {
    constructor(app: App) {
        super(app);
    }

    getSuggestions(context: EditorSuggestContext): SuggestionData[] {
        const blockIds = getBlockIds(context.editor.getValue());

        const suggestions: SuggestionData[] = [];

        blockIds.forEach((blockId) => { // loop through each definition in file
            // number of terms in the block id
            const numTermsInBlockId = blockId.split(/[ -]/).length;

            // select text going backwards for the number of terms in the block id
            const substr = (context.query.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${numTermsInBlockId}}$`)) || [''])[0].replace(/^[ -]/, '');

            console.debug(substr);

            if (normalizeId(substr) !== normalizeId(blockId)) return;

            // const cursorPos = context.editor.getCursor(); TODO space setting (also change suggestions.push to use cursorPosBeforeSpace)
            // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };

            suggestions.push({
                text: substr,
                id: blockId,
                cursor: context.editor.getCursor(),
                numTerms: numTermsInBlockId,
            });
        });

        return suggestions.sort((a, b) => b.numTerms - a.numTerms);
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        // const cursorPos = cursor;
        // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
        const originalLine = editor.getLine(cursor.line);

        if (originalLine.length === 0) return null;
        console.debug('original line not empty');

        // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return null; // TODO space setting
        // console.debug('space found');

        const blockIds = getBlockIds(editor.getValue());

        if (blockIds.length === 0) return null;

        // text representing the valid text for a blockid directly before the cursor
        const possibleBlockIdContainingStr = (originalLine.substring(0, cursor.ch).match(/[a-zA-Z0-9- ]+$/) || [''])[0]; // TODO space setting

        return {
            start: cursor, // TODO space setting (also change end to use cursorPosBeforeSpace)
            end: cursor,
            query: possibleBlockIdContainingStr,
        };
    }

    renderSuggestion(item: SuggestionData, el: HTMLElement): void {
        el.setText(item.text);
    }

    selectSuggestion(item: SuggestionData, evt: MouseEvent | KeyboardEvent): void {
        this.close();

        const editor = this.app.workspace.activeEditor?.editor;

        if (!editor) return;

        // if shift is pressed, insert the actual name of the block
        // if (evt.shiftKey) return editor.replaceRange(`[[#^${item.id}|${item.id}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);

        editor.replaceRange(`[[#^${item.id}|${item.text}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);
    }
}

export default class AutoDefinitionLink extends Plugin {
    onload(): void {
        this.registerEditorSuggest(new AutoDefinitionLinkSuggest(this.app))

        return;

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                const cursorPos = editor.getCursor();
                const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
                const originalLine = editor.getLine(cursorPos.line);

                if (originalLine.length === 0) return;

                if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return;

                const blockIds = getBlockIds(editor.getValue());

                if (blockIds.length === 0) return;

                blockIds.forEach((blockId) => { // loop through each definition in file
                    // text representing the valid text for a blockid directly before the cursor
                    const possibleBlockIdContainingStr = (originalLine.substring(0, cursorPosBeforeSpace.ch).match(/[a-zA-Z0-9- ]+$/) || [''])[0];

                    // number of terms in the block id
                    const numTermsInBlockId = blockId.split(/[ -]/).length;

                    // select text going backwards for the number of terms in the block id
                    const substr = (possibleBlockIdContainingStr.match(new RegExp(`(?:[ -]{0,1}[^ -]*){${numTermsInBlockId}}$`)) || [''])[0].replace(/^[ -]/, '');

                    if (normalizeId(substr) === normalizeId(blockId)) {
                        editor.replaceRange(`[[#^${blockId}|${substr}]]`, { line: cursorPosBeforeSpace.line, ch: cursorPosBeforeSpace.ch - substr.length }, cursorPosBeforeSpace);
                        return;
                    }
                });
            })
        );
    }
}