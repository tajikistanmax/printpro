// Список доступных оформлений кассы. Используется и в настройках (выбор),
// и на самой странице кассы (какой «скин» рисовать).
export interface PosLayoutOption {
  k: string;
  name: string;
  desc: string;
}

export const POS_LAYOUTS: PosLayoutOption[] = [
  {
    k: 'classic',
    name: 'Классический — плитка',
    desc: 'Услуги и товары крупными карточками, чек справа.',
  },
  {
    k: 'compact',
    name: 'Компактный — список',
    desc: 'Плотный список строками: удобно при большом каталоге.',
  },
];

export const DEFAULT_POS_LAYOUT = 'classic';
