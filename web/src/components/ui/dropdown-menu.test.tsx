import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu.tsx';

// jsdom rechnet keinen Kontrast; geprüft wird, dass jede Art Eintrag den Ring aus dem
// `--ring`-Token trägt (ui.md §2.13: sichtbarer Fokus auch gegen die Hervorhebung).
test('every menu item kind carries the focus ring classes', () => {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>item</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>check</DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value="a">
          <DropdownMenuRadioItem value="a">radio</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>sub</DropdownMenuSubTrigger>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const items = [
    screen.getByRole('menuitem', { name: 'item' }),
    screen.getByRole('menuitemcheckbox'),
    screen.getByRole('menuitemradio'),
    screen.getByRole('menuitem', { name: 'sub' }),
  ];
  for (const item of items) {
    expect(item.className).toContain('focus:ring-2');
    expect(item.className).toContain('focus:ring-inset');
    expect(item.className).toContain('focus:ring-ring');
  }
});
