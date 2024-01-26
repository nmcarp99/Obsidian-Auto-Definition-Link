import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Plugin, PluginSettingTab, Setting, TFile, debounce, parseYaml } from "obsidian";
import { singular } from 'pluralize';

// make sure last key pressed is space, make sure the cursor is right after the found one

/**
 * Regex used to find if text ends in a block id (e.g. `asdfasdf ^block-id` would match `^block-id`)
 */
const BLOCKIDREGEX = / \^([a-zA-Z0-9-]+$)/gm;

/**
 * Regex used to find YAML front matter
 */
const YAMLREGEX = /---\n((?:.|\n)*?)\n---/gm;

/**
 * Valid characters that can be pressed to trigger the auto link process
 */
const VALIDINTERRUPTERS = /^[^a-zA-Z-0-9]$/;

/**
 * Characters that split up terms
 */
const TERMSPLITTERS = /[^a-zA-Z0-9]/g;

interface AutoDefinitionLinkSettings {
    useSuggestions: boolean;
    useAutoLink: boolean;
    searchFileContent: boolean;
    subFolderDepth: number;
}

const DEFAULT_SETTINGS: AutoDefinitionLinkSettings = {
    useSuggestions: false,
    useAutoLink: true,
    searchFileContent: true,
    subFolderDepth: -1,
}

const _updateBlockIds = debounce(updateBlockIds, 3000);

function internalLinkElement(linkPath: string, text: string) {
    const element = document.createElement('a');
    element.dataset.tooltipPosition = 'top';
    element.setAttribute('aria-label', linkPath);
    element.setAttribute('data-href', linkPath);
    element.href = linkPath;
    element.classList.add('internal-link');
    element.target = '_blank';
    element.rel = 'noopener';
    element.innerText = text;

    return element;
}

async function updateBlockIds(app: App, editor: Editor) {
    if (AutoDefinitionLink.isUpdatingBlockIds) return;
    AutoDefinitionLink.isUpdatingBlockIds = true;

    AutoDefinitionLink.statusBarEl.setText('Searching files...');

    const startTime = Date.now();

    let maxNumTerms = 0;

    const linkDestinations: LinkDestination[] = [];

    function processFileContents(contents: string, path: string) {
        const matches = contents.matchAll(BLOCKIDREGEX);

        Array.from(matches).forEach((match) => {
            const blockNumTerms = match[1].split(TERMSPLITTERS).length;

            linkDestinations.push({
                linkPath: path + '#^' + match[1],
                searchValue: normalizeId(match[1]),
                numTerms: blockNumTerms,
            });

            if (blockNumTerms > maxNumTerms) maxNumTerms = blockNumTerms;
        });

        // match aliases of file name
        const properties = Array.from(contents.matchAll(YAMLREGEX));
        if (!properties || properties.length === 0 || properties[0].length < 2) return;

        const aliases = parseYaml(properties[0][1]).aliases as string[];
        if (!aliases) return;

        linkDestinations.push(
            ...aliases.map((alias: string) => {
                const aliasNumTerms = alias.split(TERMSPLITTERS).length;

                if (aliasNumTerms > maxNumTerms) maxNumTerms = aliasNumTerms;

                return {
                    linkPath: path,
                    searchValue: normalizeId(alias),
                    numTerms: aliasNumTerms
                }
            })
        );
    }

    const activeFile = app.workspace.getActiveFile();

    const files = app.vault.getMarkdownFiles();

    const fileProcessingPromises: Promise<number>[] = [];

    let filesProcessed = 0;

    function incrementStatusBar() {
        filesProcessed++;

        const timeEstimate =
            (Math.round(
                (Date.now() - startTime) / filesProcessed * (files.length - filesProcessed) // milliseconds
                / 10) / 100) // seconds
                .toFixed(2);

        AutoDefinitionLink.statusBarEl.setText(`Searching files... ${filesProcessed}/${files.length} processed (${timeEstimate}s)`);
    }

    files.forEach((file, i) => {
        // if (file.parent?.path !== activeFile?.parent?.path) return; // skip if the file is in not the same folder as the active file

        fileProcessingPromises.push(new Promise((resolve) => {
            const fileNameNumTerms = file.basename.split(TERMSPLITTERS).length;

            if (fileNameNumTerms > maxNumTerms) maxNumTerms = fileNameNumTerms;

            linkDestinations.push({
                linkPath: file.basename,
                searchValue: normalizeId(file.basename),
                numTerms: fileNameNumTerms,
            });

            // if search file content is disabled, skip reading the file
            if (!AutoDefinitionLink.settings.searchFileContent) {
                incrementStatusBar();
                return resolve(0);
            }

            // if the file is the active file, use the editor contents instead of reading the file (since the file may not be saved yet)
            if (file.path == activeFile?.path) {
                processFileContents(editor.getValue(), file.path);
                incrementStatusBar();
                return resolve(0);
            }

            app.vault.read(file)
                .then((contents) => {
                    processFileContents(contents, file.path);
                    incrementStatusBar();
                    return resolve(0);
                });

        }));
    });

    await Promise.all(fileProcessingPromises);

    AutoDefinitionLink.statusBarEl.setText('Indexing link database...');

    // sort link destinations by number of terms then alphabetically
    AutoDefinitionLink.linkDestinations = linkDestinations.sort((a, b) => {
        if (a.numTerms === b.numTerms) {
            if (a.searchValue < b.searchValue) return -1;
            if (a.searchValue > b.searchValue) return 1;
            return 0;
        }

        return a.numTerms - b.numTerms;
    });

    AutoDefinitionLink.maxNumTerms = maxNumTerms;

    // create a map of number of terms to the start and end index of the link destinations with that number of terms (inclusive)
    AutoDefinitionLink.linkDestinationsNumTermsRanges = {};
    let currentNumTerms = 0;

    while (currentNumTerms <= AutoDefinitionLink.maxNumTerms) {
        const startIndex = AutoDefinitionLink.linkDestinations.findIndex(linkDestination => linkDestination.numTerms === currentNumTerms);
        let endIndex = AutoDefinitionLink.linkDestinations.findIndex(linkDestination => linkDestination.numTerms > currentNumTerms) - 1;

        if (startIndex === -1) {
            currentNumTerms++;
            continue;
        }

        if (endIndex === -2) {
            endIndex = AutoDefinitionLink.linkDestinations.length - 1;
        }

        AutoDefinitionLink.linkDestinationsNumTermsRanges[currentNumTerms] = {
            start: startIndex,
            end: endIndex,
        };

        currentNumTerms++;
    }

    AutoDefinitionLink.statusBarEl.setText(`Updated block ids in ${Date.now() - startTime}ms`);

    AutoDefinitionLink.isUpdatingBlockIds = false;
}

function normalizeId(id: string): string {
    return id.toLowerCase().split(TERMSPLITTERS).map((word) => singular(word)).join('-');
}

type SuggestionData = {
    text: string,
    linkDestination: LinkDestination,
    cursor: EditorPosition,
};

type LinkDestination = {
    linkPath: string, // where it should link to
    searchValue: string, // what to search for to find the link
    numTerms: number, // number of terms in the search value
};

class AutoDefinitionLinkSuggest extends EditorSuggest<SuggestionData> {
    constructor(app: App) {
        super(app);
    }

    async getSuggestions(context: EditorSuggestContext): Promise<SuggestionData[]> {
        return AutoDefinitionLink.getSuggestions(context.query, context.editor.getCursor());
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!AutoDefinitionLink.settings.useSuggestions) return null;
        if (AutoDefinitionLink.linkDestinations.length === 0) return null;

        const originalLine = editor.getLine(cursor.line);
        if (originalLine.length === 0) return null;
        const textBeforeCursor = originalLine.slice(0, cursor.ch);

        // handle editing block ids
        const carrotIndex = originalLine.indexOf(' ^');
        if (carrotIndex !== -1 && originalLine.slice(carrotIndex, cursor.ch).match(BLOCKIDREGEX)) {
            _updateBlockIds(this.app, editor);

            return null; // cancel if editing a term
        }

        return {
            start: cursor, // TODO space setting (also change end to use cursorPosBeforeSpace)
            end: cursor,
            query: textBeforeCursor || '',
        };
    }

    renderSuggestion(item: SuggestionData, el: HTMLElement): void {
        el.setText(item.linkDestination.linkPath);
    }

    selectSuggestion(item: SuggestionData, evt: MouseEvent | KeyboardEvent): void {
        this.close();

        const editor = this.app.workspace.activeEditor?.editor;

        if (!editor) return;

        AutoDefinitionLink.replaceSuggestion(item, editor);
    }
}

class AutoDefinitionLinkSettingTab extends PluginSettingTab {
    plugin: AutoDefinitionLink;

    constructor(app: App, plugin: AutoDefinitionLink) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Use suggestions')
            .setDesc('If disabled, the plugin will not suggest links to replace block ids with')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.useSuggestions)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.useSuggestions = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Use auto link')
            .setDesc('If disabled, the plugin will not automatically convert a block id to a link after pressing space (or another valid interrupter)')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.useAutoLink)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.useAutoLink = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Search file content')
            .setDesc('If disabled, the plugin will only use the names of files and not the contents of files to find links. If you are having performance issues, DISABLE THIS.')
            .addToggle((toggle) => {
                toggle.setValue(AutoDefinitionLink.settings.searchFileContent)
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.searchFileContent = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Subfolder depth')
            .setDesc('How many subfolders deep to match link destinations; 0 = current folder only; -1 = all subfolders')
            .addText((text) => {
                text.setValue(AutoDefinitionLink.settings.subFolderDepth.toString())
                    .onChange(async (value) => {
                        AutoDefinitionLink.settings.subFolderDepth = parseInt(value);
                        await this.plugin.saveSettings();
                    });

                text.inputEl.type = 'number';
                text.inputEl.min = '-1';
            });

        new Setting(containerEl)
            .setName('Refresh Links')
            .setDesc('Refreshes the links in the current vault. This may take a while.')
            .addButton((button) => {
                button.setButtonText('Refresh Links')
                    .onClick(async () => {
                        const editor = this.app.workspace.activeEditor?.editor;

                        if (!editor) return;

                        updateBlockIds(this.app, editor);
                    });
            });
    }

}

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

        console.debug('getSuggestions');

        const startTime = Date.now();

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

        console.debug(`getSuggestions took ${Date.now() - startTime}ms`);

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

        this.registerEvent(
            this.app.workspace.on("layout-change", async () => {

                const editor = this.app.workspace.activeEditor?.editor;

                if (!editor) return;

                updateBlockIds(this.app, editor);
            })
        );

        this.registerMarkdownPostProcessor((el, ctx) => {
            function getTextRecursively(element: Element): { [text: string]: Node } {
                let texts: {
                    [text: string]: Node
                } = {};

                const children = Array.from(element.childNodes);

                children.forEach(child => {
                    console.log(child);

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

                console.log(text);
                console.log(element);

                // get separating indices
                // reverse to get most terms (least likely to match) first
                const indices: number[] = Array.from(text.matchAll(TERMSPLITTERS)).map((match) => match.index ?? 0);
                indices.push(text.length); // add the end of the string (so the last term can be matched)
                indices.reverse();

                // loop through separating indices
                indices.forEach(i => {
                    // just use first suggestion for now
                    const suggestions = AutoDefinitionLink.getSuggestions(text.slice(0, i), { line: 0, ch: 0 });

                    console.log(i);
                    console.log(suggestions);
                    console.log('-'.repeat(100));

                    if (!suggestions.length) return;

                    let usedSuggestion = false;

                    suggestions.forEach((suggestion) => {
                        if (usedSuggestion) return;

                        console.log('using suggestion');

                        // make sure to leave the original node as the first child - do not replace it
                        const beginningText = element.textContent?.slice(0, i - suggestion.text.length) ?? '';
                        const endText = element.textContent?.slice(i) ?? '';

                        element.nodeValue = beginningText;
                        const newLinkNode = element.parentNode?.insertAfter(internalLinkElement(suggestion.linkDestination.linkPath, suggestion.text), element);

                        if (!newLinkNode) throw new Error('newLinkNode is null');

                        element.parentNode?.insertAfter(document.createTextNode(endText), newLinkNode);

                        // check if the suggestion was used before setting usedSuggestion to true !!!
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
    }

    async loadSettings() {
        AutoDefinitionLink.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(AutoDefinitionLink.settings);
    }
}