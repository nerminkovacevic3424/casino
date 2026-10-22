import { isSpinHotkey } from './spin-hotkey';

function press(
  key: string,
  target: Element = document.body,
  init: KeyboardEventInit = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: target });
  return isSpinHotkey(event);
}

describe('isSpinHotkey', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('accepts Space and Enter at page level', () => {
    expect(press(' ')).toBe(true);
    expect(press('Enter')).toBe(true);
  });

  it('ignores other keys, modifiers and auto-repeat', () => {
    expect(press('a')).toBe(false);
    expect(press(' ', document.body, { ctrlKey: true })).toBe(false);
    expect(press('Enter', document.body, { shiftKey: true })).toBe(false);
    expect(press(' ', document.body, { repeat: true })).toBe(false);
  });

  it.each([
    '<input />',
    '<button>x</button>',
    '<select><option>a</option></select>',
    '<a href="#">x</a>',
    '<div role="radio">x</div>',
  ])('leaves %s alone (it handles Space/Enter itself)', (html) => {
    document.body.innerHTML = html;
    expect(press(' ', document.body.firstElementChild as Element)).toBe(false);
  });

  it('does nothing while a dialog is open', () => {
    document.body.innerHTML =
      '<dialog open><p>Paytable</p></dialog><div id="stage"></div>';
    expect(press(' ', document.getElementById('stage') as Element)).toBe(false);
  });

  it('works when the focusable game stage has focus', () => {
    document.body.innerHTML =
      '<div id="stage" tabindex="0" role="group"></div>';
    expect(press('Enter', document.getElementById('stage') as Element)).toBe(
      true,
    );
  });
});
