import { autoDefinitionLinkEditorExtension } from "editorExtension";
import { internalLinkElement, TERMSPLITTERS, SuggestionData, LinkDestination, BLOCKIDREGEX, normalizeId, VALIDINTERRUPTERS } from "shared";
import { Editor, EditorPosition, Plugin } from "obsidian";
import { _updateBlockIds, updateBlockIds } from "updateBlockIds";
import { AutoDefinitionLinkSuggest } from "suggestions";
import { AutoDefinitionLinkSettingTab, AutoDefinitionLinkSettings, DEFAULT_SETTINGS } from "settings";

export default class AutoDefinitionLink extends Plugin {
    public static linkDestinations: LinkDestination[] = [];
    public static maxNumTerms = 0;
    public static linkDestinationsNumTermsRanges: { [numTerms: number]: { start: number, end: number } } = {}; // inclusive
    public static settings: AutoDefinitionLinkSettings;
    public static statusBarEl: HTMLSpanElement;
    public static isUpdatingBlockIds = false;

    public static binarySearchLinkDestinations(searchValue: string, numTerms: number): LinkDestination[] | null {
        let start = AutoDefinitionLink.linkDestinationsNumTermsRanges[numTerms]?.start ?? 0;
        let end = AutoDefinitionLink.linkDestinationsNumTermsRanges[numTerms]?.end ?? 0;

        while (start <= end) {
            const mid = Math.floor((start + end) / 2);

            if (AutoDefinitionLink.linkDestinations[mid].searchValue === searchValue) {
                let earliestMatchingLinkDestinationIndex = mid;
                let latestMatchingLinkDestinationIndex = mid;

                // find earliest matching link destination
                while (AutoDefinitionLink.linkDestinations[earliestMatchingLinkDestinationIndex - 1]?.searchValue === searchValue) {
                    earliestMatchingLinkDestinationIndex = earliestMatchingLinkDestinationIndex - 1;
                }

                // find latest matching link destination
                while (AutoDefinitionLink.linkDestinations[latestMatchingLinkDestinationIndex + 1]?.searchValue === searchValue) {
                    latestMatchingLinkDestinationIndex = latestMatchingLinkDestinationIndex + 1;
                }

                return AutoDefinitionLink.linkDestinations.slice(earliestMatchingLinkDestinationIndex, latestMatchingLinkDestinationIndex + 1); // end is exclusive
            }

            if (AutoDefinitionLink.linkDestinations[mid].searchValue < searchValue) {
                start = mid + 1;
            } else {
                end = mid - 1;
            }
        }

        return null;
    }

    public static replaceSuggestion(suggestion: SuggestionData, editor: Editor): void {
        editor.replaceRange(`[[${suggestion.linkDestination.linkPath}|${suggestion.text}]]`, { line: suggestion.cursor.line, ch: suggestion.cursor.ch - suggestion.text.length }, suggestion.cursor);
    }

    public static getSuggestions(query: string, cursor: EditorPosition): SuggestionData[] {
        const suggestions: SuggestionData[] = [];

        for (let i = AutoDefinitionLink.maxNumTerms; i >= 1; i--) { // loop through each possible number of terms in a block id
            const substrLen = query.split(TERMSPLITTERS).slice(-i).reduce((acc, curr) => acc + curr.length, 0) + i - 1; // get the length of the last n characters
            const substr = query.split('').slice(-substrLen).join(''); // get the last n characters
            const normalizedSubstr = normalizeId(substr);

            const linkDestinations = AutoDefinitionLink.binarySearchLinkDestinations(normalizedSubstr, i);

            if (!linkDestinations?.length) continue;

            suggestions.push(
                ...linkDestinations.map(linkDestination => ({
                    text: substr,
                    linkDestination,
                    cursor
                }))
            );
        }

        return suggestions;
    }

    lastKey: string;
    lastKeyShift: boolean;

    async onload() {
        AutoDefinitionLink.statusBarEl = this.addStatusBarItem().createEl('span', { text: 'Starting up...' });

        await this.loadSettings();

        // *** start add refresh button ***
        const refreshButton = this.addStatusBarItem();
        refreshButton.addClass('mod-clickable');
        refreshButton.createEl('span', { text: '↻' });
        refreshButton.onclick = () => {
            const editor = this.app.workspace.activeEditor?.editor;

            if (!editor) return;

            updateBlockIds(this.app, editor);
        };
        // *** end add refresh button ***

        // add refresh command
        this.addCommand({
            id: 'refresh-block-ids',
            name: 'Refresh Links',
            callback: () => {
                const editor = this.app.workspace.activeEditor?.editor;

                if (!editor) return;

                updateBlockIds(this.app, editor);
            },
        });

        const editor = this.app.workspace.activeEditor?.editor;

        if (editor) {
            updateBlockIds(this.app, editor);
        }

        const autoDefinitionLinkSuggest = new AutoDefinitionLinkSuggest(this.app);
        this.registerEditorSuggest(autoDefinitionLinkSuggest);

        this.registerEvent(this.app.vault.on('create', (file) => {
            const editor = this.app.workspace.activeEditor?.editor;

            if (!editor) return;

            updateBlockIds(this.app, editor);
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            const editor = this.app.workspace.activeEditor?.editor;

            if (!editor) return;

            updateBlockIds(this.app, editor);
        }));

        this.registerEvent(this.app.vault.on('rename', (file) => {
            const editor = this.app.workspace.activeEditor?.editor;

            if (!editor) return;

            updateBlockIds(this.app, editor);
        }));

        this.registerEvent(this.app.vault.on('modify', (file) => {
            console.log('modified');

            const editor = this.app.workspace.activeEditor?.editor;

            if (!editor) return;

            _updateBlockIds(this.app, editor);

        }));

        this.registerMarkdownPostProcessor((el, ctx) => {
            function getTextRecursively(element: Element): { [text: string]: Node } {
                let texts: {
                    [text: string]: Node
                } = {};

                const children = Array.from(element.childNodes);

                children.forEach(child => {
                    if (child instanceof HTMLElement && child.hasClass('internal-link')) return;

                    if (child.nodeType === Node.TEXT_NODE) {
                        if (!child.textContent) return;

                        return texts[child.textContent] = child;
                    }

                    if (!(child instanceof HTMLElement)) return;

                    texts = {
                        ...texts,
                        ...getTextRecursively(child)
                    };
                })

                return texts;
            }

            const textMap = getTextRecursively(el);

            Object.entries(textMap).forEach(([text, element]) => {
                // get separating indices
                // reverse to get most terms (least likely to match) first
                const indices: number[] = Array.from(text.matchAll(TERMSPLITTERS)).map((match) => match.index ?? 0);
                indices.push(text.length); // add the end of the string (so the last term can be matched)
                indices.reverse();

                // loop through separating indices
                indices.forEach(i => {
                    // just use first suggestion for now
                    const suggestions = AutoDefinitionLink.getSuggestions(text.slice(0, i), { line: 0, ch: 0 });

                    if (!suggestions.length) return;

                    let usedSuggestion = false;

                    suggestions.forEach((suggestion) => {
                        if (usedSuggestion) return;

                        if (element.nodeValue?.slice(i - suggestion.text.length, i) !== suggestion.text) return; // make sure it hasn't been modified by some link before this

                        // make sure to leave the original node as the first child - do not replace it
                        const beginningText = element.textContent?.slice(0, i - suggestion.text.length) ?? '';
                        const endText = element.textContent?.slice(i) ?? '';

                        element.nodeValue = beginningText;
                        const newLinkNode = element.parentNode?.insertAfter(internalLinkElement(suggestion.linkDestination.linkPath, suggestion.text), element);

                        if (!newLinkNode) throw new Error('newLinkNode is null');

                        element.parentNode?.insertAfter(document.createTextNode(endText), newLinkNode);

                        usedSuggestion = true;
                    });
                })
            });
        });

        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            this.lastKey = evt.key;
            this.lastKeyShift = evt.shiftKey;
        });

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (!AutoDefinitionLink.settings.useAutoLink) return;

                const cursorPos = editor.getCursor();
                const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
                const originalLine = editor.getLine(cursorPos.line);

                if (originalLine.length === 0) return;
                // handle editing block ids
                const carrotIndex = originalLine.indexOf(' ^');
                if (carrotIndex !== -1 && originalLine.slice(carrotIndex, cursorPos.ch).match(BLOCKIDREGEX)) {
                    _updateBlockIds(this.app, editor);

                    return; // cancel if editing a term
                }

                if (!this.lastKey?.match(VALIDINTERRUPTERS)) return; // cancel if the last key pressed is not a valid interrupter
                if (this.lastKeyShift && this.lastKey === ' ') return; // cancel if shift is pressed with space (shift + space is used to insert the actual name of the block)
                if (AutoDefinitionLink.linkDestinations.length === 0) return;

                const possibleBlockIdContainingStr = (originalLine.substring(0, cursorPosBeforeSpace.ch) || '');

                const matchingLinkDestinations = AutoDefinitionLink.getSuggestions(possibleBlockIdContainingStr, cursorPosBeforeSpace);

                if (!matchingLinkDestinations?.length) return;

                // just take the first for now
                AutoDefinitionLink.replaceSuggestion(matchingLinkDestinations[0], editor);
            })
        );

        this.addSettingTab(new AutoDefinitionLinkSettingTab(this.app, this));

        this.registerEditorExtension(autoDefinitionLinkEditorExtension);
    }

    async loadSettings() {
        AutoDefinitionLink.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(AutoDefinitionLink.settings);
    }
}