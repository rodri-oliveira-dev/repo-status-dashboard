import { Buffer } from 'node:buffer';

const SUPPORTED_ROLES = new Set([
  'ci',
  'quality',
  'security',
  'mutation',
  'delivery',
  'release',
  'pages',
  'maintenance',
]);
const FILE_NAME = /^[a-zA-Z0-9._-]+\.ya?ml$/;

function parseInlineList(value, lineNumber) {
  if (!value.startsWith('[') || !value.endsWith(']'))
    throw new Error(`line ${lineNumber}: expected a YAML list`);
  const content = value.slice(1, -1).trim();
  return content ? content.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')) : [];
}

export function parseRepositoryConfig(source) {
  const workflows = {};
  let section = null;
  let currentRole = null;
  for (const [index, rawLine] of String(source).split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      if (line !== 'workflows:') throw new Error(`line ${lineNumber}: unsupported root key`);
      section = 'workflows';
      currentRole = null;
      continue;
    }
    if (section !== 'workflows') throw new Error(`line ${lineNumber}: expected workflows section`);
    const roleMatch = line.match(/^ {2}([a-z]+):\s*(.*)$/);
    if (roleMatch) {
      const [, role, inlineValue] = roleMatch;
      if (!SUPPORTED_ROLES.has(role))
        throw new Error(`line ${lineNumber}: unsupported role ${role}`);
      if (Object.hasOwn(workflows, role))
        throw new Error(`line ${lineNumber}: duplicate role ${role}`);
      workflows[role] = inlineValue ? parseInlineList(inlineValue, lineNumber) : [];
      currentRole = role;
      continue;
    }
    const itemMatch = line.match(/^ {4}-\s+(.+)$/);
    if (!itemMatch || !currentRole) throw new Error(`line ${lineNumber}: invalid workflow entry`);
    workflows[currentRole].push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  if (section !== 'workflows') throw new Error('missing workflows section');
  for (const [role, files] of Object.entries(workflows)) {
    if (!files.every((file) => FILE_NAME.test(file)))
      throw new Error(`role ${role}: workflow entries must be YAML file names`);
    if (new Set(files).size !== files.length)
      throw new Error(`role ${role}: duplicate workflow file`);
  }
  return { workflows };
}

export function decodeRepositoryConfig(content) {
  if (content?.encoding !== 'base64' || typeof content.content !== 'string')
    throw new Error('configuration content is not base64 encoded');
  return parseRepositoryConfig(Buffer.from(content.content, 'base64').toString('utf8'));
}
