// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderDeleteControl } from './FolderDeleteControl';
import type { Folder } from '../types';
const folder: Folder = { id: 'deleted', parentId: 'parent', name: 'Removed', sortOrder: 0, unreadCount: 0 };
let container: HTMLDivElement;
let root: Root;
const click = async (text: string) => {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
};
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe('folder deletion confirmation', () => {
  it('explains the parent destination and calls delete only after confirmation', async () => {
    const remove = vi.fn(async () => {});
    await act(async () => root.render(createElement(FolderDeleteControl, { folder, folders: [{...folder,id:'parent',name:'Parent'}], disabled: false, onDelete: remove })));
    expect(remove).not.toHaveBeenCalled();
    await click('フォルダを削除');
    expect(container.textContent).toContain('親フォルダ「Parent」へ移動');
    expect(container.textContent).toContain('配下の記事や購読先は削除しません');
    expect(remove).not.toHaveBeenCalled();
    await click('確認して削除');
    expect(remove).toHaveBeenCalledExactlyOnceWith(folder);
  });
  it('explains top-level destinations, retains an error for retry, and allows cancelling', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error('FOLDER_DELETE_NAME_CONFLICT')).mockResolvedValue(undefined);
    await act(async () => root.render(createElement(FolderDeleteControl, { folder: {...folder,parentId:null}, folders: [], disabled: false, onDelete: remove })));
    await click('フォルダを削除');
    expect(container.textContent).toContain('子フォルダは最上位へ、購読先は未分類へ');
    await click('確認して削除');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('移動先に同名');
    expect(container.textContent).toContain('確認して削除');
    await click('確認して削除');
    expect(remove).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await click('削除を取り消す');
    expect(container.textContent).not.toContain('確認して削除');
  });
});
