import { beforeEach, describe, expect, it } from 'vitest';
import { TabModel } from './tabs.ts';

const KEY = 'backe-ui:main:tabs';

describe('TabModel', () => {
  beforeEach(() => localStorage.clear());

  it('open is idempotent', () => {
    const tabs = new TabModel('main');
    tabs.open('a');
    tabs.open('b');
    tabs.open('a');
    expect(tabs.issues.value).toEqual(['a', 'b']);
  });

  it('tabs survive a reload', () => {
    const tabs = new TabModel('main');
    tabs.open('a');
    tabs.open('b');
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual(['a', 'b']);
    expect(new TabModel('main').issues.value).toEqual(['a', 'b']);
  });

  it('garbage in storage yields no tabs', () => {
    for (const raw of ['{nope', '{"a":1}', '"a"', '["a",1]', 'null']) {
      localStorage.setItem(KEY, raw);
      expect(new TabModel('main').issues.value).toEqual([]);
    }
  });

  it('tabs are kept per backlog', () => {
    new TabModel('main').open('a');
    expect(new TabModel('other').issues.value).toEqual([]);
  });

  it('close returns the right neighbour, else the left', () => {
    const tabs = new TabModel('main');
    for (const id of ['a', 'b', 'c']) tabs.open(id);
    expect(tabs.close('b')).toBe('c');
    expect(tabs.close('c')).toBe('a');
    expect(tabs.close('a')).toBeUndefined();
    expect(tabs.issues.value).toEqual([]);
    expect(new TabModel('main').issues.value).toEqual([]);
  });

  it('closing an unknown tab changes nothing', () => {
    const tabs = new TabModel('main');
    tabs.open('a');
    expect(tabs.close('zzz')).toBeUndefined();
    expect(tabs.issues.value).toEqual(['a']);
  });
});
