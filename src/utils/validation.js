import Joi from 'joi';
import config from './config.js';
import { ValidationError } from './errors.js';

const memoryStoreSchema = Joi.object({
  content: Joi.string().required().max(config.maxContentSize),
  project_root: Joi.string().when('project_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  project_id: Joi.string().optional(),
  scope: Joi.string().default('default').max(100),
  tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
  expires_at: Joi.string().isoDate().optional()
});

const memorySearchSchema = Joi.object({
  query: Joi.string().required().max(1000),
  project_root: Joi.string().when('project_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  project_id: Joi.string().optional(),
  scope: Joi.string().max(100).optional(),
  tag: Joi.string().max(50).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  use_fts: Joi.boolean().optional(),
  max_content_length: Joi.number().integer().min(1).optional()
});

const memoryDeleteSchema = Joi.object({
  id: Joi.string().required(),
  project_root: Joi.string().when('project_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  project_id: Joi.string().optional()
});

const memoryUpdateSchema = Joi.object({
  id: Joi.string().required(),
  project_root: Joi.string().when('project_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  project_id: Joi.string().optional(),
  content: Joi.string().max(config.maxContentSize).optional(),
  tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
  expires_at: Joi.string().allow('').optional()
});

const memoryListSchema = Joi.object({
  project_root: Joi.string().when('project_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  project_id: Joi.string().optional(),
  scope: Joi.string().max(100).optional(),
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0),
  max_content_length: Joi.number().integer().min(1).optional()
});

const memoryGetSchema = Joi.object({
  id: Joi.string().required(),
  project_root: Joi.string().when('project_id', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  project_id: Joi.string().optional()
});

const kbAddSchema = Joi.object({
  title: Joi.string().required().max(500),
  content: Joi.string().required().max(config.maxKbContentSize),
  source: Joi.string().max(1000).optional(),
  project_id: Joi.string().optional(),
  vector: Joi.array().items(Joi.number()).optional(),
  qdrantUrl: Joi.string().uri().optional(),
  qdrantCollection: Joi.string().max(100).optional()
});

const kbSearchSchema = Joi.object({
  query: Joi.string().required().max(1000),
  limit: Joi.number().integer().min(1).max(100).default(5),
  project_id: Joi.string().optional(),
  vector: Joi.array().items(Joi.number()).optional(),
  qdrantUrl: Joi.string().uri().optional(),
  qdrantCollection: Joi.string().max(100).optional(),
  max_content_length: Joi.number().integer().min(1).optional()
});

const kbGetSchema = Joi.object({
  id: Joi.number().integer().required(),
  project_id: Joi.string().optional()
});

const kbIndexSchema = Joi.object({
  project_id: Joi.string().required(),
  content: Joi.string().max(config.maxKbContentSize).optional()
});

const kbUpdateSchema = Joi.object({
  id: Joi.number().integer().required(),
  project_id: Joi.string().optional(),
  title: Joi.string().max(500).optional(),
  content: Joi.string().max(config.maxKbContentSize).optional(),
  source: Joi.string().max(1000).optional()
});

const kbDeleteSchema = Joi.object({
  id: Joi.number().integer().required(),
  project_id: Joi.string().optional()
});

const kbInitSchema = Joi.object({
  project_root: Joi.string().required(),
  project_id: Joi.string().optional(),
  patterns: Joi.array().items(Joi.string().max(200)).max(20).optional(),
  skip_patterns: Joi.array().items(Joi.string().max(200)).max(20).optional(),
  overwrite: Joi.boolean().optional()
});

const summaryProjectSchema = Joi.object({
  project_root: Joi.string().required(),
  project_id: Joi.string().optional(),
  auto_discover: Joi.boolean().default(false),
  include_files: Joi.array().items(Joi.string().max(500)).max(50).optional(),
  include_memory: Joi.boolean().default(true),
  include_kb: Joi.boolean().default(true)
});

const summaryDeltaSchema = Joi.object({
  project_root: Joi.string().required(),
  project_id: Joi.string().optional(),
  auto_discover: Joi.boolean().default(true),
  include_files: Joi.array().items(Joi.string().max(500)).max(50).optional(),
  include_memory: Joi.boolean().default(true),
  include_kb: Joi.boolean().default(true)
});

const dashboardSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(10),
  port: Joi.number().integer().min(1024).max(65535).optional(),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional()
});

const sourceIngestSchema = Joi.object({
  files: Joi.array().items(Joi.object({
    filename: Joi.string().required().max(500),
    content: Joi.string().max(10 * 1024 * 1024).optional(),
    file_path: Joi.string().max(1000).optional()
  })).min(1).required(),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional()
});

const sourceListSchema = Joi.object({
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

const sourceSearchSchema = Joi.object({
  query: Joi.string().required().max(1000),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

const wikiLinkSchema = Joi.object({
  source_id: Joi.string().required(),
  target_id: Joi.string().required(),
  source_type: Joi.string().valid('memory', 'source', 'kb').required(),
  target_type: Joi.string().valid('memory', 'source', 'kb').required(),
  relation: Joi.string().max(100).optional(),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional()
});

const wikiLinksSchema = Joi.object({
  entry_id: Joi.string().required(),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional(),
  direction: Joi.string().valid('in', 'out', 'both').default('both')
});

const sourceGetSchema = Joi.object({
  id: Joi.string().required(),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional()
});

const wikiLintSchema = Joi.object({
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional(),
  lint_mode: Joi.string().valid('structural', 'semantic').default('structural'),
  max_kb_entries: Joi.number().integer().min(1).max(200).optional(),
  max_memory_entries: Joi.number().integer().min(1).max(200).optional(),
  content_preview_length: Joi.number().integer().min(50).max(10000).optional()
});

const wikiExportSchema = Joi.object({
  output_dir: Joi.string().required().max(1000),
  project_id: Joi.string().optional(),
  project_root: Joi.string().optional(),
  include_sources: Joi.boolean().default(true),
  include_memory: Joi.boolean().default(true),
  include_kb: Joi.boolean().default(true)
});

export const schemas = {
  'memory.store': memoryStoreSchema,
  'memory.search': memorySearchSchema,
  'memory.delete': memoryDeleteSchema,
  'memory.update': memoryUpdateSchema,
  'memory.list': memoryListSchema,
  'memory.get': memoryGetSchema,
  'kb.add': kbAddSchema,
  'kb.search': kbSearchSchema,
  'kb.get': kbGetSchema,
  'kb.index': kbIndexSchema,
  'kb.update': kbUpdateSchema,
  'kb.delete': kbDeleteSchema,
  'kb.init': kbInitSchema,
  'summary.project': summaryProjectSchema,
  'summary.delta': summaryDeltaSchema,
  'dashboard.projects': dashboardSchema,
  'source.ingest': sourceIngestSchema,
  'source.list': sourceListSchema,
  'source.search': sourceSearchSchema,
  'source.get': sourceGetSchema,
  'wiki.link': wikiLinkSchema,
  'wiki.links': wikiLinksSchema,
  'wiki.lint': wikiLintSchema,
  'wiki.export': wikiExportSchema
};

export function validateInput(toolName, params) {
  const schema = schemas[toolName];
  if (!schema) return params; // No validation for unknown tools
  
  const { error, value } = schema.validate(params, { 
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
  
  if (error) {
    throw new ValidationError(`Validation failed: ${error.details.map(d => d.message).join(', ')}`);
  }
  
  return value;
}
