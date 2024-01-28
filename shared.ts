/**
 * Characters that split up terms
 */
export const TERMSPLITTERS = /[^a-zA-Z0-9]/g;

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