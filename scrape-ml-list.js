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
 * 
 * Requisitos:
 *   npm install puppeteer
 * 
 * Agendamento (6 em 6 horas):
 *   - GitHub Actions: .github/workflows/refresh-products.yml
 *   - Cron local: 0 */6 * * * node /path/to/scrape-ml-list.js
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
const SCROLL_DELAY_MS = 2000; // Espera entre scrolls para carregar produtos
const MAX_SCROLLS = 25; // ~300 produtos / ~12 por scroll

// ============================================================
// CATEGORIZAÇÃO AUTOMÁTICA
// ============================================================

const CATEGORY_RULES = [
  {
    id: "raquetes",
    name: "🎾 Raquetes",
    keywords: [
      "raquete", "raq ", "t-fight", "pure drive", "pure strike",
      "extreme mp", "gravity", "speed mp", "radical", "boom",
      "vcore", "ezone", "blade", "clash", "ultra",
    ],
  },
  {
    id: "tenis",
    name: "👟 Tênis",
    keywords: [
      "tênis ", "tenis ", "solution speed", "gel resolution",
      "court ff", "hypercourt", "smash", "kswiss", "asics",
    ],
  },
  {
    id: "bolas",
    name: "🟡 Bolas de Tênis",
    keywords: [
      "bola de tênis", "bola tenis", "bolas de tênis", "bolas tenis",
      "tubo", "tubos", "dunlop", "inni", "robin", "söderling",
    ],
  },
  {
    id: "mochilas",
    name: "🎒 Mochilas e Raqueteiras",
    keywords: [
      "mochila", "raqueteira", "bolsa", "backpack", "6 pack",
      "9 pack", "12 pack", "tour", "elite",
    ],
  },
  {
    id: "overgrips",
    name: "🔧 Overgrips",
    keywords: ["overgrip", "tourna grip", "ultra wrap", "pro overgrip"],
  },
  {
    id: "cordas",
    name: "🧵 Cordas",
    keywords: ["corda ", "set de corda", "poly tour", "max rotation", "encordoamento"],
  },
  {
    id: "acessorios",
    name: "🧰 Acessórios",
    keywords: [
      "antivibrador", "pressurizador", "fita demarcatória",
      "boné", "bone", "viseira", "punho", "elastico",
    ],
  },
  {
    id: "vestuario",
    name: "👕 Vestuário & Bem-Estar",
    keywords: [
      "camiseta", "meia", "meias", "toalha", "short", "bermuda",
      "calça", "jaqueta", "eletrólito", "creatina", "vitamina",
      "suplemento", "whey", "proteína",
    ],
  },
];

function categorize(productName) {
  const lower = productName.toLowerCase();
  for (const category of CATEGORY_RULES) {
    for (const keyword of category.keywords) {
      if (lower.includes(keyword)) {
        return category.id;
      }
    }
  }
  return "outros";
}

// ============================================================
// EXTRAÇÃO DE PRODUTOS DA PÁGINA
// ============================================================

async function extractProducts(page) {
  return await page.evaluate(() => {
    const products = [];
    const seen = new Set();

    // Seletores do Mercado Livre para cards de produto na lista de afiliados
    const cards = document.querySelectorAll(
      'a[href*="/up/MLBU"], a[href*="/p/MLB"], a[href*="produto.mercadolivre.com.br"]'
    );

    cards.forEach((card) => {
      const href = card.href;
      if (!href || seen.has(href)) return;
      seen.add(href);

      // Extrair ID do produto
      const idMatch =
        href.match(/MLB(\d+)/) ||
        href.match(/MLBU(\d+)/);
      const id = idMatch ? `mlb-${idMatch[1]}` : `mlb-${Date.now()}`;

      // Nome do produto (texto mais próximo)
      const name =
        card.querySelector('[class*="title"]')?.textContent?.trim() ||
        card.querySelector('h2, h3')?.textContent?.trim() ||
        card.textContent?.trim()?.slice(0, 100) ||
        "Produto";

      // Preços
      const priceText =
        card.querySelector('[class*="price"]')?.textContent?.trim() || "";
      const oldPriceText =
        card
          .querySelector('[class*="original"], s, del')
          ?.textContent?.trim() || "";

      const parsePrice = (text) => {
        if (!text) return null;
        const cleaned = text.replace(/[^\d,]/g, "").replace(",", ".");
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      };

      const price = parsePrice(priceText);
      const originalPrice = parsePrice(oldPriceText);
      const discount = originalPrice && price
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : null;

      // Frete grátis
      const freeShipping =
        card.textContent?.toLowerCase().includes("frete grátis") || false;

      // Badges
      const badges = [];
      const cardText = card.textContent || "";
      if (cardText.includes("BLACK FRIDAY")) badges.push("BLACK FRIDAY");
      if (cardText.includes("OFERTA IMPERDÍVEL")) badges.push("OFERTA IMPERDÍVEL");
      if (cardText.includes("MAIS VENDIDO")) badges.push("MAIS VENDIDO");

      // Marca
      const brandMatch = name.match(
        /^(Head|Wilson|Babolat|Yonex|Tecnifibre|Asics|Dunlop|K-Swiss|Inni|Artengo|Tourna|Topspin|Liquidz|Insider|Dark Lab|Always Fit|Robin Söderling|Essencial Labs|Relet)/i
      );
      const brand = brandMatch ? brandMatch[1].toUpperCase() : null;

      products.push({
        id,
        name: name.slice(0, 150),
        description: "",
        brand,
        price,
        originalPrice,
        discount,
        freeShipping,
        installments: null,
        seller: null,
        rating: null,
        link: href,
        badges,
        coupon: null,
      });
    });

    return products;
  });
}

// ============================================================
// SCROLL ATÉ O FIM DA LISTA
// ============================================================

async function scrollToEnd(page) {
  let previousCount = 0;
  let scrollsWithoutChange = 0;

  for (let i = 0; i < MAX_SCROLLS; i++) {
    const currentProducts = await extractProducts(page);

    if (currentProducts.length === previousCount) {
      scrollsWithoutChange++;
      if (scrollsWithoutChange >= 3) {
        console.log(`  ✅ Fim da lista: ${currentProducts.length} produtos extraídos`);
        return currentProducts;
      }
    } else {
      scrollsWithoutChange = 0;
    }

    previousCount = currentProducts.length;
    console.log(`  📜 Scroll ${i + 1}: ${currentProducts.length} produtos até agora...`);

    // Scroll para baixo
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 2);
    });

    // Espera carregar novos produtos
    await new Promise((r) => setTimeout(r, SCROLL_DELAY_MS));
  }

  return await extractProducts(page);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("🚀 Iniciando scrape da lista do Mercado Livre...\n");
  console.log(`🔗 URL: ${LIST_URL}\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();

    // Bloquear recursos desnecessários (imagens, fontes) para acelerar
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // User agent realista
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    console.log("📄 Carregando página...");
    await page.goto(LIST_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Espera o conteúdo inicial renderizar
    await new Promise((r) => setTimeout(r, 3000));

    console.log("📜 Scrollando pela lista...\n");
    const allProducts = await scrollToEnd(page);

    // Categorizar
    console.log("\n🏷️ Categorizando produtos...");
    const categoriesMap = {};

    for (const product of allProducts) {
      const catId = categorize(product.name);
      if (!categoriesMap[catId]) {
        categoriesMap[catId] = [];
      }
      categoriesMap[catId].push(product);
    }

    // Ordenar categorias
    const categoryOrder = [
      "raquetes", "tenis", "bolas", "mochilas", "overgrips",
      "cordas", "acessorios", "vestuario", "outros",
    ];

    const categories = categoryOrder
      .filter((id) => categoriesMap[id] && categoriesMap[id].length > 0)
      .map((id) => {
        const catRule = CATEGORY_RULES.find((r) => r.id === id);
        return {
          id,
          name: catRule ? catRule.name : "📦 Outros",
          products: categoriesMap[id],
        };
      });

    // Adicionar categorias não previstas
    for (const [id, products] of Object.entries(categoriesMap)) {
      if (!categoryOrder.includes(id)) {
        categories.push({
          id,
          name: "📦 Outros",
          products,
        });
      }
    }

    // Construir output
    const now = new Date();
    const nextUpdate = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    const output = {
      lastUpdated: now.toISOString(),
      nextUpdate: nextUpdate.toISOString(),
      totalProducts: allProducts.length,
      source: "https://meli.la/2dJguGW",
      categories,
    };

    // Escrever arquivo
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");

    console.log(`\n✅ SCRAPE CONCLUÍDO!`);
    console.log(`📦 ${allProducts.length} produtos em ${categories.length} categorias`);
    console.log(`💾 Arquivo salvo: ${OUTPUT_PATH}`);
    console.log(`🕐 Próxima atualização: ${nextUpdate.toLocaleString("pt-BR")}`);

    // Resumo por categoria
    console.log("\n📊 Resumo por categoria:");
    for (const cat of categories) {
      console.log(`   ${cat.name}: ${cat.products.length} produtos`);
    }
  } catch (error) {
    console.error("❌ Erro durante o scrape:", error.message);
    process.exit(1);
  } finally {
    await browser.close();
    console.log("\n👋 Browser fechado.");
  }
}

main();