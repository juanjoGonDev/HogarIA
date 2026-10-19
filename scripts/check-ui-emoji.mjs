const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/u;

const PREFERENCE_ICON_ARRAYS = new Map([
  [
    'frontend/src/app/shared/models/taste-profile.ts',
    ['COMMON_ALLERGENS', 'COMMON_LIKES', 'COMMON_DISLIKES']
  ]
]);

// Recipe guest multi-select: only the `emoji` values inside this named preset
// table are approved. Labels, notes, and arbitrary UI copy remain emoji-free.
const NESTED_PREFERENCE_ICON_MAPS = new Map([
  [
    'frontend/src/app/shared/components/ai-participants.component.ts',
    { name: 'PREFERENCE_PRESETS', keys: ['emoji'], depth: 2 }
  ]
]);

const FOOD_CATEGORY_MAPS = new Map([
  [
    'frontend/src/app/features/recipes/recipe-category-emoji.ts',
    {
      name: 'FOOD_CATEGORY_EMOJI',
      keys: ['dairy', 'meat', 'fish', 'vegetables', 'fruits', 'grains', 'spices', 'frozen']
    }
  ]
]);

const EXACT_SEMANTIC_TEXT = new Map([
  [
    'frontend/src/app/core/i18n/dict/pantry.ts',
    {
      pantryEs: [['pantry.ingredientes', '🥬 Ingredientes']],
      pantryEn: [['pantry.ingredientes', '🥬 Ingredients']]
    }
  ],
  [
    'frontend/src/app/core/i18n/dict/onboarding.ts',
    {
      onboardingEs: [
        ['onboarding.me_gusta', 'Me gusta 👍'],
        ['onboarding.mejor_no', 'Mejor no 👎']
      ],
      onboardingEn: [
        ['onboarding.me_gusta', 'I like it 👍'],
        ['onboarding.mejor_no', 'Better not 👎']
      ]
    }
  ]
]);

function normalizePath(file) {
  return file.replace(/\\/g, '/');
}

// Keep offsets stable so an emoji in a comment can never be mistaken for an approved value.
function codeWithoutComments(source) {
  const chars = source.split('');
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const next = chars[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      else chars[index] = ' ';
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index++;
        blockComment = false;
      } else if (char !== '\n' && char !== '\r') {
        chars[index] = ' ';
      }
      continue;
    }
    if (quote) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index++;
      lineComment = true;
    } else if (char === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index++;
      blockComment = true;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    }
  }

  return chars.join('');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchingBlock(code, name, opening, closing) {
  const declaration = new RegExp(
    `\\b(?:export\\s+)?const\\s+${escapeRegExp(name)}\\b[^=]*=\\s*\\${opening}`
  ).exec(code);
  if (!declaration) return null;

  const openIndex = declaration.index + declaration[0].lastIndexOf(opening);
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < code.length; index++) {
    const char = code[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;
      if (depth === 0) return { start: openIndex, end: index + 1 };
    }
  }
  return null;
}

function tokenize(code) {
  const tokens = [];
  for (let index = 0; index < code.length;) {
    const char = code[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const start = index + 1;
      const quote = char;
      index++;
      while (index < code.length) {
        if (code[index] === '\\') index += 2;
        else if (code[index] === quote) break;
        else index++;
      }
      tokens.push({ type: 'string', value: code.slice(start, index), start, end: index });
      index++;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < code.length && /[\w$]/.test(code[index])) index++;
      tokens.push({ type: 'identifier', value: code.slice(start, index), start, end: index });
      continue;
    }

    tokens.push({ type: 'punctuation', value: char, start: index, end: index + 1 });
    index++;
  }
  return tokens;
}

function propertyStringRanges(tokens, block, allowedValuesByKey, expectedDepth) {
  if (!block) return [];
  const ranges = [];
  let depth = 0;
  for (let index = 0; index + 2 < tokens.length; index++) {
    if (tokens[index].start < block.start || tokens[index].end > block.end) continue;
    if (tokens[index].start === block.start) continue;
    if (tokens[index].type === 'punctuation') {
      if (
        tokens[index].value === '{' ||
        tokens[index].value === '[' ||
        tokens[index].value === '('
      ) {
        depth++;
        continue;
      }
      if (
        tokens[index].value === '}' ||
        tokens[index].value === ']' ||
        tokens[index].value === ')'
      ) {
        depth--;
        continue;
      }
    }

    const key = tokens[index];
    if (depth !== expectedDepth) continue;
    if (tokens[index - 1].value !== '{' && tokens[index - 1].value !== ',') continue;
    const acceptedValues = allowedValuesByKey.get(key.value);
    if (!acceptedValues || tokens[index + 1].value !== ':' || tokens[index + 2].type !== 'string') {
      continue;
    }
    const value = tokens[index + 2];
    if (acceptedValues !== true && !acceptedValues.has(value.value)) continue;
    ranges.push({ start: value.start, end: value.end });
  }
  return ranges;
}

function semanticPreferenceRanges(file, code, tokens) {
  const arrays = PREFERENCE_ICON_ARRAYS.get(file) ?? [];
  const allowedIcons = new Map([['icon', true]]);
  return arrays.flatMap((name) =>
    propertyStringRanges(tokens, matchingBlock(code, name, '[', ']'), allowedIcons, 1)
  );
}

function nestedPreferenceRanges(file, code, tokens) {
  const policy = NESTED_PREFERENCE_ICON_MAPS.get(file);
  if (!policy) return [];
  return propertyStringRanges(
    tokens,
    matchingBlock(code, policy.name, '{', '}'),
    new Map(policy.keys.map((key) => [key, true])),
    policy.depth
  );
}

function foodCategoryRanges(file, code, tokens) {
  const policy = FOOD_CATEGORY_MAPS.get(file);
  if (!policy) return [];
  const block = matchingBlock(code, policy.name, '{', '}');
  return propertyStringRanges(tokens, block, new Map(policy.keys.map((key) => [key, true])), 0);
}

function exactTextRanges(file, code, tokens) {
  const objects = EXACT_SEMANTIC_TEXT.get(file) ?? {};
  return Object.entries(objects).flatMap(([name, entries]) => {
    const valuesByKey = new Map(entries.map(([key, value]) => [key, new Set([value])]));
    return propertyStringRanges(tokens, matchingBlock(code, name, '{', '}'), valuesByKey, 0);
  });
}

export function findEmojiViolations(file, text) {
  const normalized = normalizePath(file);
  const code = codeWithoutComments(text);
  const tokens = tokenize(code);
  const allowedRanges = [
    ...semanticPreferenceRanges(normalized, code, tokens),
    ...nestedPreferenceRanges(normalized, code, tokens),
    ...foodCategoryRanges(normalized, code, tokens),
    ...exactTextRanges(normalized, code, tokens)
  ];
  const violations = [];
  for (const match of text.matchAll(new RegExp(EMOJI, 'gu'))) {
    const allowed = allowedRanges.some(
      (range) => match.index >= range.start && match.index + match[0].length <= range.end
    );
    if (!allowed) violations.push({ emoji: match[0], index: match.index });
  }
  return violations;
}
