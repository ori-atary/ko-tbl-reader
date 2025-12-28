#!/usr/bin/env node

"use strict";

const path = require("path");
const fs = require("fs-extra");
const { Command } = require("commander");
const decryption = require("../decryption");
const parser = require("../lib/parser");
const { autoTBLFormatDetector } = require("../lib/tbl_format_detector");

const TYPE_CODE_MAP = {
  1: "int32",
  2: "int32",
  3: "int32",
  4: "int32",
  5: "int32",
  6: "int32",
  7: "string",
  8: "float",
  9: "float",
  10: "int32",
  11: "int32",
};

const DOMAIN_RULES = [
  {
    pattern: /(zone|region|map|area)/i,
    domain: "zones",
    tableRole: "core",
    tags: ["zone", "map", "terrain"],
    description:
      "Defines playable zones, map metadata, and supporting files used across the client.",
    title: (base) => `${base} zone metadata`,
    rowInterpretation: "Each row captures a single zone definition used by the client.",
  },
  {
    pattern: /(npc|monster|mob|character)/i,
    domain: "npcs",
    tableRole: "content",
    tags: ["npc", "spawn"],
    description:
      "Describes non-player characters, their identifiers, and how they appear or behave in the client.",
    title: (base) => `${base} NPC definitions`,
    rowInterpretation: "Each row likely represents one NPC entry.",
  },
  {
    pattern: /(item|inventory|weapon|armor|gear)/i,
    domain: "items",
    tableRole: "content",
    tags: ["item", "loot"],
    description:
      "Lists client-facing items, stats, and presentation attributes referenced in UI and gameplay.",
    title: (base) => `${base} item catalog`,
    rowInterpretation: "Each row likely corresponds to one in-game item record.",
  },
  {
    pattern: /(skill|magic|ability|buff|spell)/i,
    domain: "skills",
    tableRole: "content",
    tags: ["skill", "ability"],
    description:
      "Details skills or spells, including requirements and visual resources consumed by the client.",
    title: (base) => `${base} skill data`,
    rowInterpretation: "Each row represents a single skill or effect definition.",
  },
  {
    pattern: /(quest|mission|task)/i,
    domain: "quests",
    tableRole: "content",
    tags: ["quest", "progression"],
    description:
      "Outlines quest objectives, rewards, and progression metadata for client UI.",
    title: (base) => `${base} quest data`,
    rowInterpretation: "Each row corresponds to one quest or mission entry.",
  },
  {
    pattern: /(text|string|message|tip|caption|conversation)/i,
    domain: "strings",
    tableRole: "content",
    tags: ["localization", "ui"],
    description:
      "Provides localized strings, tooltips, and messages surfaced to the player.",
    title: (base) => `${base} localized strings`,
    rowInterpretation: "Each row stores one localized text record.",
  },
  {
    pattern: /(ui|menu|window|dialog|tooltip|panel)/i,
    domain: "ui",
    tableRole: "ui",
    tags: ["ui", "layout"],
    description:
      "Holds client UI layout, component, or option metadata consumed by front-end screens.",
    title: (base) => `${base} UI metadata`,
    rowInterpretation: "Each row describes one UI element or configuration row.",
  },
  {
    pattern: /(effect|buff|debuff|status)/i,
    domain: "effects",
    tableRole: "lookup",
    tags: ["effect", "status"],
    description:
      "Lists reusable effects or status modifiers referenced by skills, items, or zones.",
    title: (base) => `${base} effect lookup`,
    rowInterpretation: "Each row is an effect or status definition.",
  },
  {
    pattern: /(system|config|option|table|list)/i,
    domain: "system",
    tableRole: "legacy",
    tags: ["system"],
    description:
      "Contains system configuration or legacy lookup data relied on by the client runtime.",
    title: (base) => `${base} system table`,
    rowInterpretation: "Each row is a generic system configuration entry.",
  },
];

const GUIDANCE_PRESETS = {
  zones: {
    useCases: [
      "Map/zone summarization",
      "Teleport destination validation",
      "Mini-map metadata lookup",
    ],
    safeEdits: [
      "Updating descriptive names",
      "Adjusting minimap asset references",
      "Adding new zone display rows",
    ],
    dangerousEdits: [
      "Changing zone IDs referenced elsewhere",
      "Removing rows in live maps",
      "Renaming terrain files without assets",
    ],
    commonQuestions: [
      "How do I add a new zone?",
      "Which column controls the visible name?",
      "Where do minimap textures get referenced?",
    ],
  },
  npcs: {
    useCases: [
      "NPC placement stories",
      "Behavior QA prompts",
      "NPC name lookup",
    ],
    safeEdits: [
      "Correcting display strings",
      "Tweaking dialog text",
      "Adding optional metadata columns",
    ],
    dangerousEdits: [
      "Reusing existing NPC IDs",
      "Changing spawn zone references",
      "Dropping requirement columns",
    ],
    commonQuestions: [
      "Where is this NPC located?",
      "Which column links to the dialog text?",
      "How do NPC IDs relate to quest data?",
    ],
  },
  items: {
    useCases: [
      "Item tooltip generation",
      "Balance audit prompts",
      "Icon lookup",
    ],
    safeEdits: [
      "Adjusting descriptive text",
      "Adding new cosmetic tags",
      "Updating icon references",
    ],
    dangerousEdits: [
      "Modifying primary item IDs",
      "Removing requirement columns",
      "Changing stat columns blindly",
    ],
    commonQuestions: [
      "Which column controls item grade?",
      "How do I add crafting recipes?",
      "Where are icon assets referenced?",
    ],
  },
  skills: {
    useCases: [
      "Skill requirement explanation",
      "Cooldown reasoning",
      "Effect stacking analysis",
    ],
    safeEdits: [
      "Tuning descriptive fields",
      "Adding clarifying notes",
      "Appending new rows for upcoming skills",
    ],
    dangerousEdits: [
      "Adjusting key enums without server changes",
      "Changing required stats across the board",
      "Removing effects in use",
    ],
    commonQuestions: [
      "Which column is the skill ID?",
      "How do I adjust MP costs?",
      "Where do visual effects link in?",
    ],
  },
  quests: {
    useCases: [
      "Quest summary prompts",
      "Reward correlation",
      "Dependency tracing",
    ],
    safeEdits: [
      "Clarifying quest text",
      "Adding optional metadata",
      "Appending new quest rows",
    ],
    dangerousEdits: [
      "Changing quest IDs already live",
      "Removing prerequisite columns",
      "Breaking reward references",
    ],
    commonQuestions: [
      "Which column describes objectives?",
      "How are rewards defined?",
      "Where do quests link to NPCs?",
    ],
  },
  strings: {
    useCases: [
      "Localization review",
      "UI copy assistance",
      "String consistency checking",
    ],
    safeEdits: [
      "Fixing typos",
      "Adding new localized rows",
      "Updating phrasing for clarity",
    ],
    dangerousEdits: [
      "Changing string IDs without coordination",
      "Deleting strings used by UI",
      "Reordering keys relied upon by code",
    ],
    commonQuestions: [
      "Where is this UI label defined?",
      "How do I add a translation?",
      "Are these strings namespaced?",
    ],
  },
  ui: {
    useCases: [
      "UI component descriptions",
      "Control binding review",
      "Localization context",
    ],
    safeEdits: [
      "Updating tooltip text",
      "Adding optional layout notes",
      "Documenting new panels",
    ],
    dangerousEdits: [
      "Changing component IDs without code updates",
      "Removing required columns",
      "Rearranging rows assumed by client code",
    ],
    commonQuestions: [
      "How do I rename this menu entry?",
      "Which column references the icon?",
      "What controls visibility flags?",
    ],
  },
  effects: {
    useCases: [
      "Effect lookup",
      "Buff/debuff explanation",
      "Status stacking reasoning",
    ],
    safeEdits: [
      "Clarifying effect notes",
      "Adding descriptive tags",
      "Appending new effect rows",
    ],
    dangerousEdits: [
      "Changing IDs referenced by skills",
      "Removing stats columns",
      "Altering durations blindly",
    ],
    commonQuestions: [
      "Which column holds the effect script?",
      "How do I link an effect to a skill?",
      "Where is duration stored?",
    ],
  },
  system: {
    useCases: [
      "Configuration explanation",
      "Legacy data decoding",
      "Automated cleanup prompts",
    ],
    safeEdits: [
      "Documenting discovered meaning",
      "Adding new rows in unused ranges",
      "Annotating optional columns",
    ],
    dangerousEdits: [
      "Changing control flags",
      "Removing unknown columns",
      "Overwriting IDs with unclear usage",
    ],
    commonQuestions: [
      "What does this flag represent?",
      "How is this table consumed?",
      "Is it safe to add new rows?",
    ],
  },
};

const RELATION_RULES = [
  { pattern: /zone/i, target: "Zones", type: "references" },
  { pattern: /npc/i, target: "Npc", type: "references" },
  { pattern: /item/i, target: "Item", type: "references" },
  { pattern: /quest/i, target: "Quest", type: "references" },
  { pattern: /skill|magic/i, target: "Skill", type: "references" },
  { pattern: /text|string/i, target: "Texts", type: "lookup_for" },
];

const program = new Command();
program
  .option("-s, --source <dir>", "directory containing .tbl files", "testdata")
  .option("-o, --output <dir>", "output directory for AI knowledge", "ai_knowledge")
  .option("-l, --limit <count>", "limit number of tables processed", Number)
  .option("--korean", "decode string columns with EUC-KR", false)
  .option("--dry-run", "print summary without writing files", false);

program.parse(process.argv);
const options = program.opts();

async function main() {
  const sourceDir = await resolveSourceDir(options.source);
  if (!sourceDir) {
    console.error(
      `[ai-knowledge] Unable to find source directory "${options.source}" or fallback "test"`
    );
    process.exit(1);
  }

  const tblFiles = await collectTblFiles(sourceDir);
  if (!tblFiles.length) {
    console.warn(
      `[ai-knowledge] No .tbl files found under ${sourceDir}. Nothing to do.`
    );
    return;
  }

  if (options.limit && options.limit > 0) {
    tblFiles.splice(options.limit);
  }

  const outputDir = path.resolve(process.cwd(), options.output);
  const tablesDir = path.join(outputDir, "tables");

  if (!options.dryRun) {
    await fs.ensureDir(tablesDir);
    await fs.emptyDir(tablesDir);
  }

  const summaries = [];
  let successCount = 0;

  for (const filePath of tblFiles) {
    const baseFile = path.basename(filePath);
    try {
      const knowledge = await buildKnowledgeForTable(filePath, {
        sourceDir,
        korean: options.korean,
      });
      const safeName = sanitizeFileName(knowledge.table.baseName);
      const relativePath = path.join("ai_knowledge", "tables", `${safeName}.schema.json`);
      summaries.push({
        tblFile: knowledge.table.tblFile,
        baseName: knowledge.table.baseName,
        title: knowledge.semanticContext.title,
        domain: knowledge.semanticContext.domain,
        tags: knowledge.semanticContext.tags,
        confidence: knowledge.semanticContext.confidence,
        rowCount: knowledge.table.rowCount,
        columnCount: knowledge.table.columnCount,
        columns: knowledge.schema.columns.map((col) => col.name),
        knowledgePath: relativePath,
      });

      if (!options.dryRun) {
        await fs.writeJson(path.join(tablesDir, `${safeName}.schema.json`), knowledge, {
          spaces: 2,
        });
      }

      successCount++;
      console.log(`[ai-knowledge] Processed ${baseFile}`);
    } catch (error) {
      console.warn(
        `[ai-knowledge] Failed to build knowledge for ${baseFile}: ${error.message}`
      );
      const fallback = buildErrorKnowledge(baseFile, error);
      const safeName = sanitizeFileName(fallback.table.baseName);
      summaries.push({
        tblFile: fallback.table.tblFile,
        baseName: fallback.table.baseName,
        title: fallback.semanticContext.title,
        domain: fallback.semanticContext.domain,
        tags: fallback.semanticContext.tags,
        confidence: fallback.semanticContext.confidence,
        rowCount: fallback.table.rowCount,
        columnCount: fallback.table.columnCount,
        columns: [],
        knowledgePath: path.join("ai_knowledge", "tables", `${safeName}.schema.json`),
      });

      if (!options.dryRun) {
        await fs.writeJson(path.join(tablesDir, `${safeName}.schema.json`), fallback, {
          spaces: 2,
        });
      }
    }
  }

  const index = {
    generatedAt: new Date().toISOString(),
    sourceDir: path.relative(process.cwd(), sourceDir) || ".",
    tableCount: summaries.length,
    tables: summaries.sort((a, b) => a.baseName.localeCompare(b.baseName)),
  };

  if (!options.dryRun) {
    await fs.writeJson(path.join(outputDir, "index.json"), index, { spaces: 2 });
  }

  console.log(
    `[ai-knowledge] Completed. ${successCount}/${summaries.length} tables parsed successfully.`
  );
}

async function resolveSourceDir(requestedDir) {
  const requestedPath = path.resolve(process.cwd(), requestedDir);
  if (await fs.pathExists(requestedPath)) {
    return requestedPath;
  }

  if (requestedDir === "testdata") {
    const fallback = path.resolve(process.cwd(), "test");
    if (await fs.pathExists(fallback)) {
      console.warn(
        `[ai-knowledge] Falling back to ./test because ./testdata was not found.`
      );
      return fallback;
    }
  }

  return null;
}

async function collectTblFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectTblFiles(entryPath);
      results.push(...nested);
    } else if (/\.tbl$/i.test(entry.name)) {
      results.push(entryPath);
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

async function buildKnowledgeForTable(filePath, { korean }) {
  const fileName = path.basename(filePath);
  const baseName = fileName.replace(/\.tbl$/i, "");
  const tblData = await loadTbl(filePath, { korean });
  const columnDetails = buildColumnDetails(
    tblData.columns,
    tblData.detector?.desc,
    tblData.rows
  );
  const semantic = buildSemanticContext(baseName, columnDetails, tblData.rows);
  const deductions = buildDeductions(columnDetails, semantic);
  const sampleRows = buildSampleRows(columnDetails, tblData.rows);
  const aiGuidance = buildGuidance(semantic.domain);

  return {
    table: {
      tblFile: fileName,
      baseName,
      rowCount: tblData.rowCount,
      columnCount: tblData.columnCount,
      tableRole: semantic.tableRole,
    },
    schema: {
      columns: columnDetails,
      source: "ko-tbl-reader parser (read-only)",
    },
    semanticContext: semantic,
    deductions,
    examples: {
      sampleRows,
      rowInterpretation: semantic.rowInterpretation,
    },
    aiGuidance,
  };
}

async function loadTbl(filePath, { korean }) {
  const buffer = await fs.readFile(filePath);
  let decryptedBuffer = buffer;
  let encryption = "unknown";

  try {
    const result = await decryption(Buffer.from(buffer));
    if (Array.isArray(result)) {
      [encryption, decryptedBuffer] = result;
    } else if (typeof result === "string") {
      encryption = result;
      decryptedBuffer = buffer;
    }
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }

  const parseResult = await parser(decryptedBuffer, korean);
  const detector = autoTBLFormatDetector(parseResult.columns);

  return {
    ...parseResult,
    encryption,
    detector,
  };
}

function buildColumnDetails(columnTypes, detectorDesc = [], rows) {
  const sampleWindow = rows.slice(0, 50);
  const preliminary = columnTypes.map((code, idx) => {
    const sampleValues = sampleWindow.map((row) => row[idx]);
    const uniqueValues = new Set(sampleValues.map((value) => serializeValue(value)));
    const hasEmpty = sampleValues.some(
      (value) =>
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.every((item) => item === 0))
    );

    const type = TYPE_CODE_MAP[code] || "unknown";
    const nameFromDetector = detectorDesc && detectorDesc[idx] && detectorDesc[idx].trim();
    const guessedName = nameFromDetector || guessColumnName(idx, type, sampleValues);
    const columnName = sanitizeColumnName(guessedName);

    const isLikelyKey =
      idx === 0 ||
      (columnName.toLowerCase().includes("id") &&
        uniqueValues.size >= Math.min(sampleValues.length, 5));

    let notes = "";
    if (nameFromDetector) {
      notes = "Name provided by schema detector";
    } else if (idx === 0 && type === "int32") {
      notes = "Auto-labeled as primary identifier";
    } else if (isLikelyKey) {
      notes = "Likely identifier column";
    }

    return {
      name: columnName,
      type,
      nullable: hasEmpty,
      isLikelyKey,
      notes,
    };
  });

  return ensureUniqueColumnNames(preliminary);
}

function guessColumnName(idx, type, sampleValues) {
  if (idx === 0 && type === "int32") {
    return "id";
  }

  if (type === "string") {
    if (looksLikePath(sampleValues)) {
      return `resourcePath_${idx + 1}`;
    }
    if (looksLikeSentence(sampleValues)) {
      return idx === 1 ? "text" : `text_${idx + 1}`;
    }
    if (looksLikeLabel(sampleValues)) {
      return idx === 1 ? "label" : `label_${idx + 1}`;
    }
    return `value_${idx + 1}`;
  }

  if (type === "float") {
    return `value_${idx + 1}`;
  }

  if (type === "int32") {
    const numericValues = sampleValues.filter((value) => typeof value === "number");
    const uniqueNumbers = new Set(numericValues);
    if (numericValues.length && uniqueNumbers.size <= 3) {
      return `flag_${idx + 1}`;
    }
  }

  return `column_${idx + 1}`;
}

function ensureUniqueColumnNames(columns) {
  const seen = new Map();
  return columns.map((column) => {
    const count = seen.get(column.name) || 0;
    seen.set(column.name, count + 1);
    if (count > 0) {
      column.name = `${column.name}_${count + 1}`;
    }
    return column;
  });
}

function looksLikeSentence(values) {
  return values.some(
    (value) =>
      typeof value === "string" &&
      value.trim().length > 15 &&
      /[\s,.!?]/.test(value)
  );
}

function looksLikePath(values) {
  return values.some(
    (value) =>
      typeof value === "string" &&
      /[\\/]|\.dxt|\.bmp|\.n3|\.evt|\.opd|\.gtd/i.test(value)
  );
}

function looksLikeLabel(values) {
  return values.some(
    (value) =>
      typeof value === "string" &&
      value.length <= 20 &&
      /^[A-Za-z0-9 _-]+$/.test(value)
  );
}

function buildSemanticContext(baseName, columnDetails, rows) {
  const lower = baseName.toLowerCase();
  const rule =
    DOMAIN_RULES.find((candidate) => candidate.pattern.test(lower)) ||
    DOMAIN_RULES[DOMAIN_RULES.length - 1];

  const confidence = rule.pattern.test(lower) ? 0.72 : 0.45;
  const title = rule.title(baseName);
  const tags = Array.from(
    new Set([
      ...rule.tags,
      ...columnDetails
        .filter((col) => /name|title/i.test(col.name))
        .map(() => "label"),
      ...columnDetails
        .filter((col) => /id/i.test(col.name))
        .map(() => "id"),
    ])
  );

  return {
    title,
    description: rule.description,
    domain: rule.domain,
    tags,
    confidence,
    tableRole: rule.tableRole,
    rowInterpretation: rule.rowInterpretation,
  };
}

function buildDeductions(columnDetails, semantic) {
  const evidence = columnDetails.slice(0, 3).map((col) => `column:${col.name}`);
  const guesses = [
    {
      statement: semantic.description,
      confidence: semantic.confidence,
      evidence,
    },
  ];

  const relationships = [];
  for (const col of columnDetails) {
    for (const relationRule of RELATION_RULES) {
      if (relationRule.pattern.test(col.name)) {
        relationships.push({
          type: relationRule.type,
          targetTable: relationRule.target,
          viaColumn: col.name,
          confidence: 0.4,
        });
        break;
      }
    }
  }

  return {
    guesses,
    relationships,
  };
}

function buildSampleRows(columnDetails, rows) {
  const limit = Math.min(rows.length, 2);
  const columnNames = columnDetails.map((col) => col.name);
  const samples = [];

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!row) {
      continue;
    }

    const sample = {};
    columnNames.forEach((name, idx) => {
      sample[name] = sanitizeSampleValue(row[idx]);
    });
    samples.push(sample);
  }

  return samples;
}

function buildGuidance(domain) {
  const preset = GUIDANCE_PRESETS[domain] || GUIDANCE_PRESETS.system;
  return {
    useCases: preset.useCases,
    safeEdits: preset.safeEdits,
    dangerousEdits: preset.dangerousEdits,
    commonQuestions: preset.commonQuestions,
  };
}

function buildErrorKnowledge(fileName, error) {
  const baseName = fileName.replace(/\.tbl$/i, "");
  const message = error && error.message ? error.message : "Unknown error";
  return {
    table: {
      tblFile: fileName,
      baseName,
      rowCount: 0,
      columnCount: 0,
      tableRole: "unknown",
    },
    schema: {
      columns: [],
      source: "ko-tbl-reader parser (read-only)",
    },
    semanticContext: {
      title: `${baseName} (unparsed)`,
      description: `Table could not be parsed: ${message}`,
      domain: "system",
      tags: ["error"],
      confidence: 0.1,
      tableRole: "unknown",
      rowInterpretation: "No row interpretation available because parsing failed.",
    },
    deductions: {
      guesses: [
        {
          statement: "Parsing failed, so semantics are unknown.",
          confidence: 0.1,
          evidence: ["parser-error"],
        },
      ],
      relationships: [],
    },
    examples: {
      sampleRows: [],
      rowInterpretation:
        "No samples available because input could not be decoded.",
    },
    aiGuidance: buildGuidance("system"),
  };
}

function sanitizeColumnName(name) {
  return name.replace(/\s+/g, "_");
}

function sanitizeSampleValue(value) {
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSampleValue(entry));
  }

  return value;
}

function sanitizeFileName(name) {
  return name.replace(/[^A-Za-z0-9_\-]/g, "_");
}

function serializeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).join(",");
  }

  return value.toString();
}

main().catch((error) => {
  console.error(`[ai-knowledge] Unhandled error: ${error.stack || error.message}`);
  process.exit(1);
});
