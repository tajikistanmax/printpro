// Список оформлений второго экрана (дисплей покупателя). Используется в настройках
// (выбор) и на самой странице /customer-display (какой «скин» рисовать).
export interface DisplayLayoutOption {
  k: string;
  name: string;
  desc: string;
}

export const DISPLAY_LAYOUTS: DisplayLayoutOption[] = [
  {
    k: 'aurora',
    name: 'Аврора',
    desc: 'Фиолетово-индиговый градиент, часы, приветствие с категориями, крупные суммы. (текущий)',
  },
];

export const DEFAULT_DISPLAY_LAYOUT = 'aurora';
