/**
 * The wikilinks pre-pass rewrites the document BEFORE the compiler. Its three
 * invariants break silently: rewriting inside a code block corrupts an
 * example, rewriting inside the frontmatter corrupts the metadata, and
 * translating a note embed produces an image that does not exist. We pin them
 * down one by one.
 *
 * The resolver is injected (see wikilinksCore.ts): the tests describe a fake
 * vault with a plain object, with no Obsidian and no disk.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { translateWikiEmbeds } from '../src/wikilinksCore.ts';

/** Fake vault: file name → resolved absolute path. */
const vault = (index: Record<string, string>) => (target: string) => index[target] ?? null;

const VAULT = vault({
  'logo.png': '/vault/assets/logo.png',
  'photo.JPG': '/vault/img/photo.JPG',
  'naïve architecture.svg': '/vault/Resources/naïve architecture.svg',
  'Other note': '/vault/Other note.md',
  'spreadsheet.xlsx': '/vault/data/spreadsheet.xlsx',
});

const translate = (s: string) => translateWikiEmbeds(s, VAULT);

describe('wikilinks — image embed translation', () => {
  it('translates an embed into a Markdown image pointing at the resolved absolute path', () => {
    assert.equal(translate('![[logo.png]]'), '![](</vault/assets/logo.png>)');
  });

  it('reuses the alias as alt text — it carries the DSL image role', () => {
    assert.equal(translate('![[logo.png|right]]'), '![right](</vault/assets/logo.png>)');
  });

  it('trims the spaces around the target and the alias', () => {
    assert.equal(translate('![[ logo.png | cover ]]'), '![cover](</vault/assets/logo.png>)');
  });

  it('wraps the destination in <…>: spaces and accents stay readable for markdown-it', () => {
    assert.equal(
      translate('![[naïve architecture.svg]]'),
      '![](</vault/Resources/naïve architecture.svg>)',
    );
  });

  it('ignores the anchor or the block of an embed (#section, ^block)', () => {
    assert.equal(translate('![[logo.png#top]]'), '![](</vault/assets/logo.png>)');
    assert.equal(translate('![[logo.png^block|left]]'), '![left](</vault/assets/logo.png>)');
  });

  it('recognizes the extension regardless of case', () => {
    assert.equal(translate('![[photo.JPG]]'), '![](</vault/img/photo.JPG>)');
  });

  it('translates several embeds on the same line', () => {
    assert.equal(
      translate('![[logo.png]] and ![[photo.JPG|right]]'),
      '![](</vault/assets/logo.png>) and ![right](</vault/img/photo.JPG>)',
    );
  });
});

describe('wikilinks — what must NOT be translated', () => {
  it('leaves a note embed intact: it is not an image', () => {
    assert.equal(translate('![[Other note]]'), '![[Other note]]');
  });

  it('leaves an embed to a non-image file intact (spreadsheet, pdf…)', () => {
    assert.equal(translate('![[spreadsheet.xlsx]]'), '![[spreadsheet.xlsx]]');
  });

  it('leaves intact an embed whose target is not found in the vault', () => {
    assert.equal(translate('![[ghost.png]]'), '![[ghost.png]]');
  });

  it('leaves a plain wikilink intact — only EMBEDS ("!") are translated', () => {
    assert.equal(translate('[[logo.png]]'), '[[logo.png]]');
  });
});

describe('wikilinks — protected zones', () => {
  it('does not touch the frontmatter', () => {
    const src = ['---', 'title: ![[logo.png]]', '---', '![[logo.png]]'].join('\n');
    const out = translate(src).split('\n');
    assert.equal(out[1], 'title: ![[logo.png]]');
    assert.equal(out[3], '![](</vault/assets/logo.png>)');
  });

  it('does not touch the inside of a ``` fence — an example stays an example', () => {
    const src = ['```markdown', '![[logo.png]]', '```', '![[logo.png]]'].join('\n');
    const out = translate(src).split('\n');
    assert.equal(out[1], '![[logo.png]]');
    assert.equal(out[3], '![](</vault/assets/logo.png>)');
  });

  it('does not touch the inside of a ~~~ fence', () => {
    const src = ['~~~', '![[logo.png]]', '~~~'].join('\n');
    assert.equal(translate(src).split('\n')[1], '![[logo.png]]');
  });

  it('does not close a ``` fence on a ~~~ (distinct markers)', () => {
    const src = ['```', '~~~', '![[logo.png]]', '```', '![[logo.png]]'].join('\n');
    const out = translate(src).split('\n');
    assert.equal(out[2], '![[logo.png]]', 'the ``` fence was closed by a ~~~');
    assert.equal(out[4], '![](</vault/assets/logo.png>)');
  });

  it('does not mistake a slide-separating "---" for the end of an absent frontmatter', () => {
    // without frontmatter, the first "---" opens a slide: nothing is protected
    const src = ['![[logo.png]]', '---', '![[logo.png]]'].join('\n');
    const out = translate(src).split('\n');
    assert.equal(out[0], '![](</vault/assets/logo.png>)');
    assert.equal(out[2], '![](</vault/assets/logo.png>)');
  });
});

describe('wikilinks — document preservation', () => {
  it('returns a document with no embed strictly unchanged', () => {
    const src = '---\ntitle: Test\n---\n\n# Title\n\nSome text.\n\n```js\nconst a = 1;\n```\n';
    assert.equal(translate(src), src);
  });

  it('normalizes CRLF line endings to LF without losing a line', () => {
    const src = '# Title\r\n\r\n![[logo.png]]\r\n';
    assert.equal(translate(src), '# Title\n\n![](</vault/assets/logo.png>)\n');
  });
});
