export type Lang = 'en' | 'ru' | 'zh';

export interface Messages {
  cancelled: string;
  done: string;
  saved: string;

  // tags (after the brand in the intro line)
  tagUp: string;
  tagDown: string;
  tagServers: string;
  tagPresets: string;
  tagLang: string;

  // up
  upNoPayload: string;
  upNoSuchPath: (p: string) => string;
  upFolderZipQ: (name: string) => string;
  upFolderNeedsZip: string;
  upArchiving: string;
  upArchived: (size: string) => string;
  upPasswordPrompt: string;
  upPasswordRequired: string;
  upEncrypting: string;
  upCreating: string;
  upUploading: (size: string) => string;
  upUploaded: string;
  upShareLink: string;
  upOwnerHint: string;
  limExpiresIn: (d: string) => string;
  limUnlimited: string;
  limDownloads: (n: number) => string;
  limUnlocksIn: (d: string) => string;
  limPassword: string;

  // settings
  setSettings: string;
  setCustom: string;
  setCustomHint: string;
  setLifetime: string;
  setHour1: string;
  setDay1: string;
  setDay7: string;
  setDay30: string;
  setCustomDots: string;
  setLifetimeCustom: string;
  setDownloads: string;
  setUnlimited: string;
  setBurn: string;
  setCustomLimit: string;
  setMaxDownloads: string;
  setTimeLockQ: string;
  setUnlockAfter: string;
  setPasswordQ: string;
  setNoPreset: (n: string) => string;
  vDuration: string;
  vPositiveInt: string;

  // presets
  preBuiltin: string;
  preDefaultTag: string;
  preName: string;
  preSaved: (n: string, d: string) => string;
  preDefaultSet: (n: string) => string;
  preRemoved: (n: string) => string;
  preNoPreset: (n: string) => string;
  preUsageRm: string;
  preMenuQ: string;
  preAdd: string;
  preSetDefault: string;
  preRemove: string;
  preDone: string;
  preNoCustom: string;
  preRemoveWhich: string;
  preMakeDefaultWhich: string;
  descUnlimited: string;
  descOne: string;
  descMany: (n: number) => string;
  descUnlock: (d: string) => string;

  // servers
  srvWhich: string;
  srvUrl: string;
  srvName: string;
  srvAdded: (n: string, u: string) => string;
  srvDefaultSet: (n: string) => string;
  srvRemoved: (n: string) => string;
  srvNoServers: string;
  srvUsageAdd: string;
  srvUsageRm: string;
  srvNoNamed: (n: string) => string;
  srvNoProfile: (n: string) => string;
  srvMenuQ: string;
  srvAdd: string;
  srvSetDefault: string;
  srvRemove: string;
  srvDone: string;

  // down
  dnFetchingHeader: string;
  dnDeriving: string;
  dnDownloading: string;
  dnDecrypting: string;
  dnDecrypted: string;
  dnPwPrompt: string;
  dnPwFlagNeeded: string;
  dnMessage: string;
  dnSaveQ: string;
  dnFileName: string;
  dnFormat: string;
  dnShownNotSaved: string;
  dnSaveAs: (name: string, ext: string) => string;

  // validation (file names)
  vRequired: string;
  vInvalidChar: string;
  vNoTrailing: string;
  vExtChars: string;

  // api / link errors
  errUnauthorized: string;
  errGone: string;
  errLocked: string;
  errHttp: (what: string, s: number) => string;
  errBadLink: string;
  errLinkMissing: string;

  // menu
  menuQ: string;
  menuUp: string;
  menuDown: string;
  menuServers: string;
  menuPresets: string;
  menuFilePath: string;
  menuText: string;
  menuLink: string;

  // lang
  langPrompt: string;
  langSet: (name: string) => string;
  langNames: Record<Lang, string>;
}

const en: Messages = {
  cancelled: 'Cancelled.',
  done: 'Done',
  saved: 'Saved ',
  tagUp: ' up',
  tagDown: ' down',
  tagServers: ' servers',
  tagPresets: ' presets',
  tagLang: ' language',

  upNoPayload: 'Provide a file/folder path, or use --text "..."',
  upNoSuchPath: (p) => `no such file or folder: ${p}`,
  upFolderZipQ: (name) => `"${name}" is a folder — zip it into an archive?`,
  upFolderNeedsZip: 'A folder must be archived to upload. Re-run with --zip.',
  upArchiving: 'Archiving folder',
  upArchived: (size) => `Archived (${size})`,
  upPasswordPrompt: 'Password to protect the drop',
  upPasswordRequired: 'password required (set SHARE_ME_PASSWORD or run interactively)',
  upEncrypting: 'Encrypting',
  upCreating: 'Creating drop',
  upUploading: (size) => `Uploading ${size}`,
  upUploaded: 'Uploaded',
  upShareLink: 'Share link',
  upOwnerHint: 'owner token (keep it to revoke later):',
  limExpiresIn: (d) => `expires in ${d}`,
  limUnlimited: 'unlimited downloads',
  limDownloads: (n) => `${n} download${n === 1 ? '' : 's'}`,
  limUnlocksIn: (d) => `unlocks in ${d}`,
  limPassword: 'password-protected',

  setSettings: 'Settings',
  setCustom: 'Custom…',
  setCustomHint: 'set each option',
  setLifetime: 'Lifetime',
  setHour1: '1 hour',
  setDay1: '1 day',
  setDay7: '7 days',
  setDay30: '30 days',
  setCustomDots: 'Custom…',
  setLifetimeCustom: 'Lifetime (e.g. 12h, 3d, 2w)',
  setDownloads: 'Downloads',
  setUnlimited: 'Unlimited',
  setBurn: 'Burn after reading (1)',
  setCustomLimit: 'Custom limit…',
  setMaxDownloads: 'Max downloads',
  setTimeLockQ: 'Time-lock (not downloadable until later)?',
  setUnlockAfter: 'Unlock after (e.g. 1h, 2d)',
  setPasswordQ: 'Password-protect?',
  setNoPreset: (n) => `no preset "${n}" (see: share-me presets)`,
  vDuration: 'e.g. 30m, 12h, 7d, 2w',
  vPositiveInt: 'a positive number',

  preBuiltin: ' [built-in]',
  preDefaultTag: ' (default)',
  preName: 'Preset name',
  preSaved: (n, d) => `saved preset ${n} · ${d}`,
  preDefaultSet: (n) => `default preset -> ${n}`,
  preRemoved: (n) => `removed ${n}`,
  preNoPreset: (n) => `no preset "${n}"`,
  preUsageRm: 'usage: share-me presets rm <name>',
  preMenuQ: 'What now?',
  preAdd: 'Add a preset',
  preSetDefault: 'Set default',
  preRemove: 'Remove a custom preset',
  preDone: 'Done',
  preNoCustom: 'no custom presets to remove',
  preRemoveWhich: 'Remove which?',
  preMakeDefaultWhich: 'Make which one default?',
  descUnlimited: 'unlimited',
  descOne: '1 download',
  descMany: (n) => `${n} downloads`,
  descUnlock: (d) => `unlock +${d}`,

  srvWhich: 'Which server?',
  srvUrl: 'Server URL',
  srvName: 'Name for this server',
  srvAdded: (n, u) => `added ${n} -> ${u}`,
  srvDefaultSet: (n) => `default -> ${n}`,
  srvRemoved: (n) => `removed ${n}`,
  srvNoServers: 'no servers yet. add one: share-me servers add <name> <url>',
  srvUsageAdd: 'usage: share-me servers add <name> <url>',
  srvUsageRm: 'usage: share-me servers rm <name>',
  srvNoNamed: (n) => `no server named "${n}"`,
  srvNoProfile: (n) => `no server profile "${n}". Add it with: share-me servers add ${n} <url>`,
  srvMenuQ: 'What now?',
  srvAdd: 'Add a server',
  srvSetDefault: 'Set default',
  srvRemove: 'Remove a server',
  srvDone: 'Done',

  dnFetchingHeader: 'Fetching header',
  dnDeriving: 'Deriving keys',
  dnDownloading: 'Downloading',
  dnDecrypting: 'Decrypting',
  dnDecrypted: 'Decrypted',
  dnPwPrompt: 'This drop is password-protected',
  dnPwFlagNeeded: 'this drop is password-protected; pass --password <password>',
  dnMessage: 'Message',
  dnSaveQ: 'Save this to a file?',
  dnFileName: 'File name (without extension)',
  dnFormat: 'Format / extension',
  dnShownNotSaved: 'Shown above, not saved.',
  dnSaveAs: (name, ext) => (ext ? `Save "${name}" as (no extension, ${ext} is added)` : `Save "${name}" (file name)`),

  vRequired: 'required',
  vInvalidChar: 'invalid character (one of < > " | ? *)',
  vNoTrailing: 'cannot end with a space or a dot',
  vExtChars: 'letters and digits only',

  errUnauthorized: 'unauthorized (wrong key?)',
  errGone: 'this drop is gone (expired, burned, or never existed)',
  errLocked: 'this drop is time-locked and not yet unlocked',
  errHttp: (what, s) => `${what} failed: HTTP ${s}`,
  errBadLink: 'not a valid share link (expected a full URL with ?f= and #k=)',
  errLinkMissing: 'link is missing the ?f= id or the #k= key',

  menuQ: 'What do you want to do?',
  menuUp: 'Send a file, folder, or text',
  menuDown: 'Receive a link',
  menuServers: 'Manage servers',
  menuPresets: 'Manage presets',
  menuFilePath: 'File or folder path (leave empty for text)',
  menuText: 'Text to share',
  menuLink: 'Share link',

  langPrompt: 'Interface language',
  langSet: (name) => `language -> ${name}`,
  langNames: { en: 'English', ru: 'Русский', zh: '繁體中文' },
};

const ru: Messages = {
  cancelled: 'Отменено.',
  done: 'Готово',
  saved: 'Сохранено ',
  tagUp: ' отправка',
  tagDown: ' получение',
  tagServers: ' серверы',
  tagPresets: ' пресеты',
  tagLang: ' язык',

  upNoPayload: 'Укажи путь к файлу/папке или используй --text "..."',
  upNoSuchPath: (p) => `нет такого файла или папки: ${p}`,
  upFolderZipQ: (name) => `«${name}» это папка — упаковать её в архив?`,
  upFolderNeedsZip: 'Папку нужно упаковать в архив. Запусти с --zip.',
  upArchiving: 'Упаковка папки',
  upArchived: (size) => `Упаковано (${size})`,
  upPasswordPrompt: 'Пароль для защиты дропа',
  upPasswordRequired: 'нужен пароль (задай SHARE_ME_PASSWORD или запусти интерактивно)',
  upEncrypting: 'Шифрование',
  upCreating: 'Создание дропа',
  upUploading: (size) => `Загрузка ${size}`,
  upUploaded: 'Загружено',
  upShareLink: 'Ссылка',
  upOwnerHint: 'owner-токен (сохрани, чтобы потом отозвать):',
  limExpiresIn: (d) => `живёт ${d}`,
  limUnlimited: 'без лимита скачиваний',
  limDownloads: (n) => `${n} ${pluralRu(n, 'скачивание', 'скачивания', 'скачиваний')}`,
  limUnlocksIn: (d) => `откроется через ${d}`,
  limPassword: 'под паролем',

  setSettings: 'Настройки',
  setCustom: 'Свои…',
  setCustomHint: 'задать каждый параметр',
  setLifetime: 'Время жизни',
  setHour1: '1 час',
  setDay1: '1 день',
  setDay7: '7 дней',
  setDay30: '30 дней',
  setCustomDots: 'Своё…',
  setLifetimeCustom: 'Время жизни (напр. 12h, 3d, 2w)',
  setDownloads: 'Скачивания',
  setUnlimited: 'Без лимита',
  setBurn: 'Сжечь после прочтения (1)',
  setCustomLimit: 'Свой лимит…',
  setMaxDownloads: 'Макс. скачиваний',
  setTimeLockQ: 'Тайм-лок (нельзя скачать до момента)?',
  setUnlockAfter: 'Открыть через (напр. 1h, 2d)',
  setPasswordQ: 'Защитить паролем?',
  setNoPreset: (n) => `нет пресета «${n}» (смотри: share-me presets)`,
  vDuration: 'напр. 30m, 12h, 7d, 2w',
  vPositiveInt: 'положительное число',

  preBuiltin: ' [встроенный]',
  preDefaultTag: ' (по умолчанию)',
  preName: 'Имя пресета',
  preSaved: (n, d) => `пресет сохранён ${n} · ${d}`,
  preDefaultSet: (n) => `пресет по умолчанию -> ${n}`,
  preRemoved: (n) => `удалён ${n}`,
  preNoPreset: (n) => `нет пресета «${n}»`,
  preUsageRm: 'использование: share-me presets rm <имя>',
  preMenuQ: 'Что дальше?',
  preAdd: 'Добавить пресет',
  preSetDefault: 'Сделать по умолчанию',
  preRemove: 'Удалить свой пресет',
  preDone: 'Готово',
  preNoCustom: 'своих пресетов для удаления нет',
  preRemoveWhich: 'Какой удалить?',
  preMakeDefaultWhich: 'Какой сделать по умолчанию?',
  descUnlimited: 'без лимита',
  descOne: '1 скачивание',
  descMany: (n) => `${n} ${pluralRu(n, 'скачивание', 'скачивания', 'скачиваний')}`,
  descUnlock: (d) => `откр. +${d}`,

  srvWhich: 'Какой сервер?',
  srvUrl: 'URL сервера',
  srvName: 'Имя для этого сервера',
  srvAdded: (n, u) => `добавлен ${n} -> ${u}`,
  srvDefaultSet: (n) => `по умолчанию -> ${n}`,
  srvRemoved: (n) => `удалён ${n}`,
  srvNoServers: 'серверов пока нет. добавь: share-me servers add <имя> <url>',
  srvUsageAdd: 'использование: share-me servers add <имя> <url>',
  srvUsageRm: 'использование: share-me servers rm <имя>',
  srvNoNamed: (n) => `нет сервера с именем «${n}»`,
  srvNoProfile: (n) => `нет профиля сервера «${n}». Добавь: share-me servers add ${n} <url>`,
  srvMenuQ: 'Что дальше?',
  srvAdd: 'Добавить сервер',
  srvSetDefault: 'Сделать по умолчанию',
  srvRemove: 'Удалить сервер',
  srvDone: 'Готово',

  dnFetchingHeader: 'Получение заголовка',
  dnDeriving: 'Вывод ключей',
  dnDownloading: 'Скачивание',
  dnDecrypting: 'Расшифровка',
  dnDecrypted: 'Расшифровано',
  dnPwPrompt: 'Дроп защищён паролем',
  dnPwFlagNeeded: 'дроп защищён паролем; передай --password <пароль>',
  dnMessage: 'Сообщение',
  dnSaveQ: 'Сохранить в файл?',
  dnFileName: 'Имя файла (без расширения)',
  dnFormat: 'Формат / расширение',
  dnShownNotSaved: 'Показано выше, не сохранено.',
  dnSaveAs: (name, ext) => (ext ? `Сохранить «${name}» как (без расширения, ${ext} добавится)` : `Сохранить «${name}» (имя файла)`),

  vRequired: 'обязательно',
  vInvalidChar: 'недопустимый символ (один из < > " | ? *)',
  vNoTrailing: 'не может заканчиваться пробелом или точкой',
  vExtChars: 'только буквы и цифры',

  errUnauthorized: 'не авторизовано (неверный ключ?)',
  errGone: 'дроп недоступен (истёк, сожжён или не существовал)',
  errLocked: 'дроп под тайм-локом и ещё не открыт',
  errHttp: (what, s) => `${what}: ошибка HTTP ${s}`,
  errBadLink: 'это не валидная ссылка (нужен полный URL с ?f= и #k=)',
  errLinkMissing: 'в ссылке нет ?f= id или ключа #k=',

  menuQ: 'Что хочешь сделать?',
  menuUp: 'Отправить файл, папку или текст',
  menuDown: 'Получить по ссылке',
  menuServers: 'Управление серверами',
  menuPresets: 'Управление пресетами',
  menuFilePath: 'Путь к файлу или папке (пусто = текст)',
  menuText: 'Текст для отправки',
  menuLink: 'Ссылка',

  langPrompt: 'Язык интерфейса',
  langSet: (name) => `язык -> ${name}`,
  langNames: { en: 'English', ru: 'Русский', zh: '繁體中文' },
};

const zh: Messages = {
  cancelled: '已取消。',
  done: '完成',
  saved: '已儲存 ',
  tagUp: ' 傳送',
  tagDown: ' 接收',
  tagServers: ' 伺服器',
  tagPresets: ' 預設組合',
  tagLang: ' 語言',

  upNoPayload: '請提供檔案／資料夾路徑，或使用 --text "..."',
  upNoSuchPath: (p) => `找不到檔案或資料夾：${p}`,
  upFolderZipQ: (name) => `「${name}」是資料夾 — 要壓縮成封存檔嗎？`,
  upFolderNeedsZip: '資料夾必須壓縮後才能上傳。請加上 --zip 重新執行。',
  upArchiving: '正在壓縮資料夾',
  upArchived: (size) => `已壓縮（${size}）`,
  upPasswordPrompt: '保護此分享的密碼',
  upPasswordRequired: '需要密碼（設定 SHARE_ME_PASSWORD 或以互動模式執行）',
  upEncrypting: '加密中',
  upCreating: '建立分享中',
  upUploading: (size) => `上傳中 ${size}`,
  upUploaded: '已上傳',
  upShareLink: '分享連結',
  upOwnerHint: 'owner 權杖（保留它以便日後撤銷）：',
  limExpiresIn: (d) => `${d} 後過期`,
  limUnlimited: '無限次下載',
  limDownloads: (n) => `${n} 次下載`,
  limUnlocksIn: (d) => `${d} 後解鎖`,
  limPassword: '已加密碼',

  setSettings: '設定',
  setCustom: '自訂…',
  setCustomHint: '逐項設定',
  setLifetime: '有效期',
  setHour1: '1 小時',
  setDay1: '1 天',
  setDay7: '7 天',
  setDay30: '30 天',
  setCustomDots: '自訂…',
  setLifetimeCustom: '有效期（例如 12h、3d、2w）',
  setDownloads: '下載次數',
  setUnlimited: '無限制',
  setBurn: '閱後即焚（1 次）',
  setCustomLimit: '自訂次數…',
  setMaxDownloads: '最多下載次數',
  setTimeLockQ: '時間鎖（到指定時間前無法下載）？',
  setUnlockAfter: '解鎖時間（例如 1h、2d）',
  setPasswordQ: '要設定密碼嗎？',
  setNoPreset: (n) => `沒有預設組合「${n}」（請見：share-me presets）`,
  vDuration: '例如 30m、12h、7d、2w',
  vPositiveInt: '正整數',

  preBuiltin: ' [內建]',
  preDefaultTag: ' (預設)',
  preName: '預設組合名稱',
  preSaved: (n, d) => `已儲存預設組合 ${n} · ${d}`,
  preDefaultSet: (n) => `預設組合 -> ${n}`,
  preRemoved: (n) => `已移除 ${n}`,
  preNoPreset: (n) => `沒有預設組合「${n}」`,
  preUsageRm: '用法：share-me presets rm <名稱>',
  preMenuQ: '接下來？',
  preAdd: '新增預設組合',
  preSetDefault: '設為預設',
  preRemove: '移除自訂預設組合',
  preDone: '完成',
  preNoCustom: '沒有可移除的自訂預設組合',
  preRemoveWhich: '要移除哪一個？',
  preMakeDefaultWhich: '要把哪一個設為預設？',
  descUnlimited: '無限',
  descOne: '1 次下載',
  descMany: (n) => `${n} 次下載`,
  descUnlock: (d) => `解鎖 +${d}`,

  srvWhich: '哪一個伺服器？',
  srvUrl: '伺服器網址',
  srvName: '此伺服器的名稱',
  srvAdded: (n, u) => `已新增 ${n} -> ${u}`,
  srvDefaultSet: (n) => `預設 -> ${n}`,
  srvRemoved: (n) => `已移除 ${n}`,
  srvNoServers: '尚無伺服器。新增：share-me servers add <名稱> <網址>',
  srvUsageAdd: '用法：share-me servers add <名稱> <網址>',
  srvUsageRm: '用法：share-me servers rm <名稱>',
  srvNoNamed: (n) => `找不到名為「${n}」的伺服器`,
  srvNoProfile: (n) => `沒有伺服器設定檔「${n}」。新增：share-me servers add ${n} <網址>`,
  srvMenuQ: '接下來？',
  srvAdd: '新增伺服器',
  srvSetDefault: '設為預設',
  srvRemove: '移除伺服器',
  srvDone: '完成',

  dnFetchingHeader: '正在取得標頭',
  dnDeriving: '正在推導金鑰',
  dnDownloading: '下載中',
  dnDecrypting: '解密中',
  dnDecrypted: '已解密',
  dnPwPrompt: '此分享有密碼保護',
  dnPwFlagNeeded: '此分享有密碼保護；請傳入 --password <密碼>',
  dnMessage: '訊息',
  dnSaveQ: '要儲存成檔案嗎？',
  dnFileName: '檔名（不含副檔名）',
  dnFormat: '格式／副檔名',
  dnShownNotSaved: '已顯示於上方，未儲存。',
  dnSaveAs: (name, ext) => (ext ? `將「${name}」儲存為（不含副檔名，會自動加上 ${ext}）` : `將「${name}」儲存為（檔名）`),

  vRequired: '必填',
  vInvalidChar: '含有不允許的字元（< > " | ? * 之一）',
  vNoTrailing: '結尾不可為空格或句點',
  vExtChars: '僅限英文字母與數字',

  errUnauthorized: '未授權（金鑰錯誤？）',
  errGone: '此分享已不存在（已過期、已焚毀或從未存在）',
  errLocked: '此分享處於時間鎖，尚未解鎖',
  errHttp: (what, s) => `${what} 失敗：HTTP ${s}`,
  errBadLink: '不是有效的分享連結（需含 ?f= 與 #k= 的完整網址）',
  errLinkMissing: '連結缺少 ?f= 識別碼或 #k= 金鑰',

  menuQ: '你想做什麼？',
  menuUp: '傳送檔案、資料夾或文字',
  menuDown: '以連結接收',
  menuServers: '管理伺服器',
  menuPresets: '管理預設組合',
  menuFilePath: '檔案或資料夾路徑（留空則傳文字）',
  menuText: '要分享的文字',
  menuLink: '分享連結',

  langPrompt: '介面語言',
  langSet: (name) => `語言 -> ${name}`,
  langNames: { en: 'English', ru: 'Русский', zh: '繁體中文' },
};

function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const CATALOGS: Record<Lang, Messages> = { en, ru, zh };
export const LANGS: Lang[] = ['en', 'ru', 'zh'];

let active: Messages = en;
let activeLang: Lang = 'en';

export function setLanguage(lang: Lang): void {
  active = CATALOGS[lang] ?? en;
  activeLang = CATALOGS[lang] ? lang : 'en';
}

export function getLanguage(): Lang {
  return activeLang;
}

/** Active message catalog. */
export function t(): Messages {
  return active;
}

export function normalizeLang(s?: string): Lang | null {
  if (!s) return null;
  const l = s.toLowerCase();
  if (l.startsWith('ru')) return 'ru';
  if (l.startsWith('zh') || l.includes('chinese') || l.includes('hant') || l.includes('hans')) return 'zh';
  if (l.startsWith('en')) return 'en';
  return null;
}
