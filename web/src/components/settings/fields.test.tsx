import { cleanup, render, screen } from '@testing-library/react';
import { Field } from './fields.tsx';

afterEach(cleanup);

const describedText = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' | ');

test('a field labels its input and describes it by hint and error', () => {
  const { rerender } = render(
    <Field label="Name" hint="Kleinbuchstaben">
      {({ id, describedBy, invalid }) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
      )}
    </Field>,
  );
  const input = screen.getByRole('textbox', { name: 'Name' });
  expect(describedText(input)).toBe('Kleinbuchstaben');
  expect(input.getAttribute('aria-invalid')).toBe('false');

  rerender(
    <Field label="Name" hint="Kleinbuchstaben" error="Name ist vergeben">
      {({ id, describedBy, invalid }) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
      )}
    </Field>,
  );
  expect(describedText(input)).toBe('Kleinbuchstaben | Name ist vergeben');
  expect(input.getAttribute('aria-invalid')).toBe('true');

  rerender(
    <Field label="Name">
      {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
    </Field>,
  );
  expect(input.hasAttribute('aria-describedby')).toBe(false);
});
