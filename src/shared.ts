import { EditorPosition } from "obsidian";
import { singular } from "pluralize";

/**
 * Characters that split up terms
 */
export const TERMSPLITTERS = /[^a-zA-Z0-9]/g;

/**
 * Regex used to find if text ends in a block id (e.g. `asdfasdf ^block-id` would match `^block-id`)
 */
export const BLOCKIDREGEX = / \^([a-zA-Z0-9-]+$)/gm;

/**
 * Regex used to find YAML front matter
 */
export const YAMLREGEX = /---\n((?:.|\n)*?)\n---/gm;

/**
 * Valid characters that can be pressed to trigger the auto link process
 */
export const VALIDINTERRUPTERS = /^[^a-zA-Z-0-9]$/;

export type LinkDestination = {
    linkPath: string, // where it should link to
    searchValue: string, // what to search for to find the link
    numTerms: number, // number of terms in the search value
};

export type SuggestionData = {
    text: string,
    linkDestination: LinkDestination,
    cursor: EditorPosition,
};

export function internalLinkElement(linkPath: string, text: string) {
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

export function normalizeId(id: string): string {
    return id.toLowerCase().split(TERMSPLITTERS).map((word) => singular(word)).join('-');
}