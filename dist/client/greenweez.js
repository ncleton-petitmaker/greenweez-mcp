import { z } from "zod";
import { ContractChangedError } from "./errors.js";
import { ConfirmationStore } from "./confirmation-store.js";
import { GreenweezCartClient } from "./cart.js";
const productSchema = z.object({ reference: z.string().min(1), name: z.string().min(1), brand: z.string().nullable(), price: z.string().nullable(), unitPrice: z.string().nullable(), url: z.string().url() });
const searchSchema = z.object({ query: z.string().min(1), page: z.number().int().positive(), total: z.number().int().nonnegative(), products: z.array(productSchema) });
const detailSchema = productSchema.extend({ description: z.string().min(1), ingredients: z.string().nullable(), allergens: z.string().nullable(), nutrition: z.string().nullable(), origin: z.string().nullable(), delivery: z.string().nullable() });
const searchExpression = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim() || null;
  const price = (root) => clean(root.querySelector('ins')?.textContent || [...root.querySelectorAll('p')].map(x => x.textContent).find(x => /€/.test(x)));
  const products = [...document.querySelectorAll('main article')].map(article => {
    const link = article.querySelector('a[href*="/produit/"]'); if (!link) return null;
    const href = new URL(link.getAttribute('href'), location.origin).toString();
    const reference = href.split('/').filter(Boolean).pop(); const img = link.querySelector('img');
    const texts = [...article.querySelectorAll('p')].map(x => clean(x.textContent)).filter(Boolean);
    const name = clean(img?.getAttribute('alt')) || texts.find(x => x && x.length > 3) || null;
    const productIndex = texts.findIndex(x => x === name);
    const brand = productIndex > 0 ? texts[productIndex - 1] : null;
    const unitPrice = texts.find(x => /€\\s*\\/\\s*(?:kg|l)/i.test(x || '')) || null;
    return reference && name ? { reference, name, brand, price: price(article), unitPrice, url: href } : null;
  }).filter(Boolean);
  const heading = clean(document.querySelector('main h1')?.textContent);
  const totalText = clean(document.querySelector('main [role="status"]')?.textContent) || '';
  const total = Number((totalText.match(/\\d[\\d\\s]*/) || ['0'])[0].replace(/\\s/g, ''));
  return { query: heading, total, products };
})()`;
const detailExpression = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim() || null;
  const main = document.querySelector('main'); const title = clean(main?.querySelector('h1')?.textContent);
  const all = clean(main?.textContent) || '';
  const labelled = (label) => { const p = [...main.querySelectorAll('p')].find(x => new RegExp('^\\\\s*' + label + '\\\\s*:', 'i').test(x.textContent || '')); return p ? clean((p.textContent || '').replace(new RegExp('^\\\\s*' + label + '\\\\s*:\\\\s*', 'i'), '')) : null; };
  const reference = labelled('Référence');
  const descriptionHeading = [...main.querySelectorAll('h2')].find(x => clean(x.textContent) === 'Description produit');
  const description = [...main.querySelectorAll('p')].filter(x => !!descriptionHeading && !!(descriptionHeading.compareDocumentPosition(x) & 4)).map(x => clean(x.textContent)).find(x => x && !/^(Référence|Date de durabilité minimale)\\s*:/i.test(x) && x.length > 30) || null;
  const price = clean(main.querySelector('ins')?.textContent) || (all.match(/prix\\s*:\\s*([\\d,.]+€)/i) || [])[1] || null;
  const unitPrice = (all.match(/([\\d,.]+€\\s*\\/\\s*(?:kg|l))/i) || [])[1] || null;
  const brandLink = [...main.querySelectorAll('a[href*="/marque/"]')].find(x => clean(x.textContent));
  return { reference, name: title, brand: clean(brandLink?.textContent), price: clean(price), unitPrice: clean(unitPrice), url: location.href, description, ingredients: labelled('Ingrédients'), allergens: labelled('Allergènes'), nutrition: labelled('Valeurs nutritionnelles pour 100g'), origin: labelled('Origine'), delivery: (all.match(/Délai de livraison\\s*([^\\n]+)/i) || [])[1] || null };
})()`;
function parse(schema, value, operation) {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
        throw new ContractChangedError(`Le contrat HTML Greenweez a changé pendant ${operation} : ${parsed.error.issues[0]?.message ?? 'données invalides'}.`);
    return parsed.data;
}
export class GreenweezClient {
    browser;
    cartClient;
    constructor(browser, confirmations = new ConfirmationStore()) {
        this.browser = browser;
        this.cartClient = new GreenweezCartClient(browser, confirmations);
    }
    async search(query, page) {
        const normalized = query.trim();
        const url = new URL(`https://www.greenweez.com/recherche/${encodeURIComponent(normalized)}`);
        if (page > 1)
            url.searchParams.set("page", String(page));
        const extracted = parse(z.object({ query: z.string().nullable(), total: z.number(), products: z.array(productSchema) }), await this.browser.read(url, searchExpression), "la recherche");
        if (!extracted.query || extracted.query.localeCompare(normalized, "fr", { sensitivity: "base" }) !== 0)
            throw new ContractChangedError("La page retournée ne correspond pas à la recherche demandée.");
        return { ...extracted, query: normalized, page };
    }
    async product(reference, slug) {
        const validReference = /^[A-Z0-9]+$/i.test(reference);
        const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug);
        if (!validReference || !validSlug)
            throw new ContractChangedError("La référence ou le slug produit est invalide.");
        const product = parse(detailSchema, await this.browser.read(new URL(`https://www.greenweez.com/produit/${slug}/${reference}`), detailExpression), "la fiche produit");
        if (product.reference !== reference)
            throw new ContractChangedError("La fiche produit retournée ne correspond pas à la référence demandée.");
        return product;
    }
    async cart() {
        return this.cartClient.getCart();
    }
    async previewAddToCart(reference, slug) {
        const product = await this.product(reference, slug);
        return this.cartClient.previewAdd({ reference: product.reference, slug, name: product.name, brand: product.brand, price: product.price, url: product.url });
    }
    async previewRemoveFromCart(reference) {
        return this.cartClient.previewRemove(reference);
    }
    async confirmAddToCart(confirmationToken) {
        return this.cartClient.confirm(confirmationToken, "add");
    }
    async confirmRemoveFromCart(confirmationToken) {
        return this.cartClient.confirm(confirmationToken, "remove");
    }
}
