#!/usr/bin/env node

/**
 * SCRAPER — Lista de Produtos do Mercado Livre (Afiliados)
 * =========================================================
 * 
 * Extrai todos os produtos da lista social do Mercado Livre usando Puppeteer.
 * A lista carrega via infinite scroll — este script faz scroll até o fim.
 * 
 * Uso:
 *   node scripts/scrape-ml-list.js
 * 
 * Output:
 *   src/data/products.json (sobrescrito com dados atualizados)
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const LIST_URL =
  "https://www.mercadolivre.com.br/social/guilhermehenriqueslgomes/lists/559c8689-0a90-4ca1-b709-d5f921abaefa?matt_tool=32550142&forceInApp=true";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "data", "products.json");
const SCROLL_DELAY_MS = 2500;
const MAX_SCROLLS = 30;

// ============================================================
// CATEGORIZAÇÃO AUTOMÁTICA
// ============================================================

const CATEGORY_RULES = [
  { id: "raquetes", name: "🎾 Raquetes", keywords: ["raquete", "raq ", "t-fight", "pure drive", "pure strike", "extreme mp", "gravity", "speed mp", "radical", "boom", "vcore", "ezone", "blade", "clash", "ultra"] },
  { id: "tenis", name: "👟 Tênis", keywords: ["tênis ", "tenis ", "solution speed", "gel resolution", "court ff", "hypercourt", "smash", "kswiss", "asics"] },
  { id: "bolas", name: "🟡 Bolas de Tênis", keywords: ["bola de tênis", "bola tenis", "bolas de tênis", "bolas tenis", "tubo", "tubos", "dunlop", "inni", "robin", "söderling"] },
  { id: "mochilas", name: "🎒 Mochilas e Raqueteiras", keywords: ["mochila", "raqueteira", "bolsa", "backpack", "6 pack", "9 pack", "12 pack", "tour", "elite"] },
  { id: "overgrips", name: "🔧 Overgrips", keywords: ["overgrip", "tourna grip", "ultra wrap", "pro overgrip"] },
  { id: "cordas", name: "🧵 Cordas", keywords: ["corda ", "set de corda", "poly tour", "max rotation", "encordoamento"] },
  { id: "acessorios", name: "🧰 Acessórios", keywords: ["antivibrador", "pressurizador", "fita demarcatória", "boné", "bone", "viseira", "punho", "elastico"] },
  { id: "vestuario", name: "👕 Vestuário & Bem-Estar", keywords: ["camiseta", "meia", "meias", "toalha", "short", "bermuda", "calça", "jaqueta", "eletrólito", "creatina", "vitamina", "suplemento", "whey", "proteína"] },
];

function categorize(productName) {
  const lower = productName.toLowerCase();
  for (const category of CATEGORY_RULES) {
    for (const keyword of category.keywords) {
      if (lower.includes(keyword)) return category.id;
    }
  }
  return "outros";
}

// ============================================================
// EXTRAÇÃO DE PRODUTOS
// ============================================================

async function extractProducts(page) {
  return await page.evaluate(() => {
    const products = [];
    const seen = new Set();
    const cards = document.querySelectorAll('a[href*="/up/MLBU"], a[href*="/p/MLB"], a[href*="produto.mercadolivre.com.br"]');

    cards.forEach((card) => {
      const href = card.href;
      if (!href || seen.has(href)) return;
      seen.add(href);

      const idMatch = href.match(/MLB(\d+)/) || href.match(/MLBU(\d+)/);
      const id = idMatch ? `mlb-${idMatch[1]}` : `mlb-${Date.now()}`;

      const name = card.querySelector('[class*="title"]')?.textContent?.trim() ||
                   card.querySelector('h2, h3')?.textContent?.trim() ||
                   card.textContent?.trim()?.slice(0, 100) || "Produto";

      const priceText = card.querySelector('[class*="price"]')?.textContent?.trim() || "";
      const oldPriceText = card.querySelector('[class*="original"], s, del')?.textContent?.trim() || "";

      const parsePrice = (text) => {
        if (!text) return null;
        const cleaned = text.replace(/[^\d,]/g, "").replace(",", ".");
        const num = parseFloat(cleaned);
        return
