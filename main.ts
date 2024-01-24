import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Notice, Plugin, PluginSettingTab, Setting, TFile, parseYaml } from "obsidian";
import { singular } from 'pluralize';

// make sure last key pressed is space, make sure the cursor is right after the found one

interface AutoDefinitionLinkSettings {
    useSuggestions: boolean;
    useAutoLink: boolean;
}

const DEFAULT_SETTINGS: AutoDefinitionLinkSettings = {
    useSuggestions: false,
    useAutoLink: true,
}

// const updateBlockIds = debounce(_updateBlockIds, 1000);

async function updateBlockIds(app: App, editor: Editor, path = "") {
    new Notice('Updating block ids...');

    const startTime = Date.now();

    let maxNumTerms = 0;

    const linkDestinations: LinkDestination[] = [];

    function processFileContents(contents: string, path: string) {
        const matches = contents.matchAll(/ \^([a-zA-Z0-9-]+$)/gm);

        Array.from(matches).forEach((match) => {
            const blockNumTerms = match[1].split(/[ -]/).length;

            linkDestinations.push({
                linkPath: path + '#^' + match[1],
                searchValue: normalizeId(match[1]),
                numTerms: blockNumTerms,
            });

            if (blockNumTerms > maxNumTerms) maxNumTerms = blockNumTerms;
        });

        // match aliases of file name
        const properties = Array.from(contents.matchAll(/---\n((?:.|\n)*?)\n---/gm));
        if (!properties || properties.length === 0 || properties[0].length < 2) return;

        const aliases = parseYaml(properties[0][1]).aliases as string[];
        if (!aliases) return;

        linkDestinations.push(
            ...aliases.map((alias: string) => {
                const aliasNumTerms = alias.split(/[ -]/).length;

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

    files.forEach((file, i) => {
        // if (file.parent?.path !== activeFile?.parent?.path) continue; // skip if the file is in not the same folder as the active file

        fileProcessingPromises.push(new Promise((resolve) => {
            const fileNameNumTerms = file.basename.split(/[ -]/).length;

            if (fileNameNumTerms > maxNumTerms) maxNumTerms = fileNameNumTerms;

            linkDestinations.push({
                linkPath: file.basename,
                searchValue: normalizeId(file.basename),
                numTerms: fileNameNumTerms,
            });

            // if the file is the active file, use the editor contents instead of reading the file (since the file may not be saved yet)
            if (file.path == activeFile?.path) {
                processFileContents(editor.getValue(), file.path);
                return resolve(0);
            }

            app.vault.read(file)
                .then((contents) => {
                    processFileContents(contents, file.path);
                    return resolve(0);
                });

        }));
    });

    new Notice('Started all link destination searches...');

    const reminderNoticeInterval = setInterval(() => {
        new Notice('Still searching for link destinations...');
    }, 3000);

    await Promise.all(fileProcessingPromises);

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

    clearInterval(reminderNoticeInterval);

    new Notice(`Updated block ids in ${Date.now() - startTime}ms`);
}

function normalizeId(id: string): string {
    return id.replace(/ /g, '-').toLowerCase().split('-').map((word) => singular(word)).join('-');
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
        const suggestions: SuggestionData[] = [];

        console.debug('getSuggestions');

        const startTime = Date.now();

        for (let i = AutoDefinitionLink.maxNumTerms; i >= 1; i--) { // loop through each possible number of terms in a block id
            const substrLen = context.query.split(/[- ]/).slice(-i).reduce((acc, curr) => acc + curr.length, 0) + i - 1; // get the length of the last n characters
            const substr = context.query.split('').slice(-substrLen).join(''); // get the last n characters
            const normalizedSubstr = normalizeId(substr);

            // const linkDestination = AutoDefinitionLink.linkDestinations.find(linkDestination => linkDestination.searchValue == normalizedSubstr);
            const linkDestinations = AutoDefinitionLink.binarySearchLinkDestinations(normalizedSubstr, i);

            if (!linkDestinations?.length) continue;

            // const cursorPos = context.editor.getCursor(); TODO space setting (also change suggestions.push to use cursorPosBeforeSpace)
            // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };

            suggestions.push(
                ...linkDestinations.map(linkDestination => ({
                    text: substr,
                    linkDestination,
                    cursor: context.editor.getCursor(),
                }))
            );
        }

        console.debug(`getSuggestions took ${Date.now() - startTime}ms`);

        return suggestions;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        if (!AutoDefinitionLink.settings.useSuggestions) return null;

        if (AutoDefinitionLink.linkDestinations.length === 0) return null;

        // const cursorPos = cursor;
        // const cursorPosBeforeSpace = { line: cursorPos.line, ch: cursorPos.ch - 1 };
        const originalLine = editor.getLine(cursor.line);

        if (originalLine.length === 0) return null;

        const textBeforeCursor = originalLine.slice(0, cursor.ch);

        const carrotIndex = originalLine.indexOf(' ^');

        if (carrotIndex !== -1 && originalLine.slice(carrotIndex, cursor.ch).match(/\^([a-zA-Z0-9-]+$)/)) {
            updateBlockIds(this.app, editor);

            return null; // cancel if editing a term
        }

        // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return null; // TODO space setting
        // console.debug('space found');

        // text representing the valid text for a blockid directly before the cursor
        const possibleBlockIdContainingStr = (textBeforeCursor || ''); // TODO space setting

        return {
            start: cursor, // TODO space setting (also change end to use cursorPosBeforeSpace)
            end: cursor,
            query: possibleBlockIdContainingStr,
        };
    }

    renderSuggestion(item: SuggestionData, el: HTMLElement): void {
        el.setText(item.linkDestination.linkPath);
    }

    selectSuggestion(item: SuggestionData, evt: MouseEvent | KeyboardEvent): void {
        this.close();

        const editor = this.app.workspace.activeEditor?.editor;

        if (!editor) return;

        // if shift is pressed, insert the actual name of the block
        // if (evt.shiftKey) return editor.replaceRange(`[[#^${item.id}|${item.id}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);

        editor.replaceRange(`[[${item.linkDestination.linkPath}|${item.text}]]`, { line: item.cursor.line, ch: item.cursor.ch - item.text.length }, item.cursor);
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
    }

}

export default class AutoDefinitionLink extends Plugin {
    public static linkDestinations: LinkDestination[] = [];
    public static maxNumTerms = 0;
    public static linkDestinationsNumTermsRanges: { [numTerms: number]: { start: number, end: number } } = {}; // inclusive
    public static settings: AutoDefinitionLinkSettings;

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

    lastKey: string;
    lastKeyShift: boolean;

    async onload() {
        await this.loadSettings();

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

                if (originalLine.substring(0, cursorPos.ch).match(/\^([a-zA-Z0-9-]+$)/)) {
                    updateBlockIds(this.app, editor);

                    return; // cancel if editing a term
                }

                const validInterrupters = /[?.!,; ]/;

                if (!this.lastKey?.match(validInterrupters)) return; // cancel if the last key pressed is not a valid interrupter

                if (this.lastKeyShift && this.lastKey === ' ') return; // cancel if shift is pressed with space (shift + space is used to insert the actual name of the block)

                // if (originalLine.charAt(cursorPosBeforeSpace.ch) !== ' ') return;

                if (AutoDefinitionLink.linkDestinations.length === 0) return;

                // const matchingLinks: {
                //     linkDestination: LinkDestination,
                //     text: string,
                // }[] = [];

                for (let i = AutoDefinitionLink.maxNumTerms; i >= 1; i--) { // loop through each possible number of terms in a block id
                    // text representing the valid text for a blockid directly before the cursor
                    const possibleBlockIdContainingStr = (originalLine.substring(0, cursorPosBeforeSpace.ch) || '');

                    // select text going backwards for the number of terms in the block id
                    const substrLen = possibleBlockIdContainingStr.split(/[- ]/).slice(-i).reduce((acc, curr) => acc + curr.length, 0) + i - 1;
                    const substr = possibleBlockIdContainingStr.split('').slice(-substrLen).join(''); // get the last n characters
                    const normalizedSubstr = normalizeId(substr);

                    const linkDestinations = AutoDefinitionLink.binarySearchLinkDestinations(normalizedSubstr, i);

                    if (!linkDestinations?.length) continue;

                    // just take the first for now
                    editor.replaceRange(`[[${linkDestinations[0].linkPath}|${substr}]]`, { line: cursorPosBeforeSpace.line, ch: cursorPosBeforeSpace.ch - substr.length }, cursorPosBeforeSpace);

                    return;

                    // matchingLinks.push(
                    //     ...linkDestinations.map(linkDestination => ({
                    //         linkDestination,
                    //         text: substr,
                    //     }))
                    // );
                }
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