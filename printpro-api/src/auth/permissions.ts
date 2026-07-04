// Справочник всех прав PrintPro.
// code — техническое имя, label — что видит человек, group — раздел.

export const PERMISSIONS: { code: string; label: string; group: string }[] = [
  // Услуги
  { code: 'services.view', label: 'Просмотр услуг', group: 'Услуги' },
  { code: 'services.manage', label: 'Управление услугами', group: 'Услуги' },

  // Товары и склад
  { code: 'products.view', label: 'Просмотр товаров', group: 'Склад' },
  { code: 'products.manage', label: 'Управление товарами', group: 'Склад' },
  { code: 'stock.view', label: 'Просмотр остатков', group: 'Склад' },
  { code: 'stock.manage', label: 'Приход и списание', group: 'Склад' },

  // Заказы и касса
  { code: 'orders.view', label: 'Просмотр заказов', group: 'Заказы' },
  {
    code: 'orders.manage',
    label: 'Создание и изменение заказов',
    group: 'Заказы',
  },
  { code: 'cash.view', label: 'Просмотр кассы', group: 'Касса' },
  { code: 'cash.operate', label: 'Проведение оплат', group: 'Касса' },
  {
    code: 'pos.discountUnlimited',
    label: 'Скидка сверх лимита',
    group: 'Касса',
  },

  // Производство
  {
    code: 'production.view',
    label: 'Просмотр производства',
    group: 'Производство',
  },
  {
    code: 'production.manage',
    label: 'Управление производством',
    group: 'Производство',
  },

  // Дизайн-макеты
  { code: 'design.view', label: 'Просмотр макетов', group: 'Дизайн' },
  { code: 'design.manage', label: 'Управление макетами', group: 'Дизайн' },

  // Клиенты
  { code: 'clients.view', label: 'Просмотр клиентов', group: 'Клиенты' },
  { code: 'clients.manage', label: 'Управление клиентами', group: 'Клиенты' },

  // Задачи
  { code: 'tasks.view', label: 'Просмотр задач', group: 'Задачи' },
  { code: 'tasks.manage', label: 'Управление задачами', group: 'Задачи' },

  // Отчёты
  { code: 'reports.view', label: 'Просмотр отчётов', group: 'Отчёты' },

  // Зарплата
  { code: 'payroll.view', label: 'Просмотр зарплаты', group: 'Зарплата' },
  {
    code: 'payroll.manage',
    label: 'Расчёт и выплата зарплаты',
    group: 'Зарплата',
  },

  // Администрирование
  {
    code: 'users.view',
    label: 'Просмотр сотрудников',
    group: 'Администрирование',
  },
  {
    code: 'users.manage',
    label: 'Управление сотрудниками',
    group: 'Администрирование',
  },
  {
    code: 'roles.manage',
    label: 'Управление ролями и правами',
    group: 'Администрирование',
  },
  {
    code: 'settings.manage',
    label: 'Настройки платформы',
    group: 'Администрирование',
  },
  {
    code: 'audit.view',
    label: 'Просмотр журнала действий',
    group: 'Администрирование',
  },
];

// Системные роли и их права по умолчанию.
// '*' = все права (Администратор).
export const SYSTEM_ROLES: { name: string; permissions: string[] | '*' }[] = [
  {
    name: 'Администратор',
    permissions: '*',
  },
  {
    name: 'Директор',
    // всё, кроме настроек платформы
    permissions: PERMISSIONS.map((p) => p.code).filter(
      (c) => c !== 'settings.manage',
    ),
  },
  {
    name: 'Бухгалтер',
    permissions: [
      'cash.view',
      'cash.operate',
      'reports.view',
      'payroll.view',
      'payroll.manage',
      'orders.view',
      'clients.view',
    ],
  },
  {
    name: 'Складчик',
    permissions: [
      'products.view',
      'products.manage',
      'stock.view',
      'stock.manage',
    ],
  },
  {
    name: 'Сотрудник',
    permissions: [
      'orders.view',
      'orders.manage',
      'cash.view',
      'cash.operate',
      'production.view',
      'production.manage',
      'design.view',
      'design.manage',
      'services.view',
      'tasks.view',
      'clients.view',
    ],
  },
  // --- Готовые пресеты должностей (поверх гибких прав) ---
  {
    name: 'Кассир',
    permissions: [
      'cash.view',
      'cash.operate',
      'orders.view',
      'orders.manage',
      'clients.view',
      'services.view',
    ],
  },
  {
    name: 'Менеджер заказов',
    permissions: [
      'orders.view',
      'orders.manage',
      'clients.view',
      'clients.manage',
      'services.view',
      'design.view',
      'production.view',
      'tasks.view',
      'tasks.manage',
      'reports.view',
    ],
  },
  {
    name: 'Дизайнер',
    permissions: [
      'design.view',
      'design.manage',
      'orders.view',
      'services.view',
      'tasks.view',
      'clients.view',
    ],
  },
  {
    name: 'Печатник',
    permissions: [
      'production.view',
      'production.manage',
      'orders.view',
      'design.view',
      'stock.view',
      'tasks.view',
    ],
  },
];
