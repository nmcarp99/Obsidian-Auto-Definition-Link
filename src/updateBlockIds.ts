import AutoDefinitionLink from "src/main";
import { App, Editor, MarkdownView, debounce, parseYaml } from "obsidian";
import { BLOCKIDREGEX, LinkDestination, TERMSPLITTERS, YAMLREGEX, retrieveAliasesFromContent, normalizeId, retrieveBlockMatchesFromContent } from "src/shared";

export const _updateBlockIds = debounce(updateBlockIds, 2000);

export async function updateBlockIds(app: App, editor: Editor) {
    try {
        if (AutoDefinitionLink.isUpdatingBlockIds) return;
        AutoDefinitionLink.isUpdatingBlockIds = true;

        AutoDefinitionLink.statusBarEl.setText('Searching files...');

        const startTime = Date.now();

        let maxNumTerms = 0;

        const linkDestinations: LinkDestination[] = [];

        const processFileContents = (contents: string, path: string) => {

            // process the file contents to find block ids
            (() => {
                const blockMatches = retrieveBlockMatchesFromContent(contents);
                if (!blockMatches) return; // no block ids found

                linkDestinations.push(
                    ...blockMatches.map((match: string) => {
                        const blockNumTerms = match.split(TERMSPLITTERS).length;

                        if (blockNumTerms > maxNumTerms) maxNumTerms = blockNumTerms;

                        return {
                            linkPath: path + '#^' + match,
                            searchValue: normalizeId(match),
                            numTerms: blockNumTerms
                        }
                    })
                );
            })();

            // process the file contents to find aliases
            (() => {
                const aliases = retrieveAliasesFromContent(contents);
                if (!aliases) return; // no aliases found

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
            })();
        }

        const activeFile = app.workspace.getActiveFile();

        const files = app.vault.getMarkdownFiles();

        const fileProcessingPromises: Promise<number>[] = [];

        let filesProcessed = 0;

        const incrementStatusBar = () => {
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
                    linkPath: file.path,
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

                app.vault.cachedRead(file)
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

        // trigger a refresh of the links
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                leaf.view.editor.setCursor(leaf.view.editor.getCursor());
            }
        });
    } catch (e) {
        console.error(e);
        AutoDefinitionLink.statusBarEl.setText('Error updating block ids');
    } finally {
        AutoDefinitionLink.isUpdatingBlockIds = false;
    }
}