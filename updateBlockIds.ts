import AutoDefinitionLink from "main";
import { App, Editor, MarkdownView, debounce, parseYaml } from "obsidian";
import { BLOCKIDREGEX, LinkDestination, TERMSPLITTERS, YAMLREGEX, normalizeId } from "shared";

export const _updateBlockIds = debounce(updateBlockIds, 2000);

export async function updateBlockIds(app: App, editor: Editor) {
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

    // trigger a refresh of the links
    app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof MarkdownView) {
            leaf.view.editor.setCursor(leaf.view.editor.getCursor());
        }
    });
}