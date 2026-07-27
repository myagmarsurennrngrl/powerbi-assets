/**
 * Every user-visible string in the application, in Mongolian.
 *
 * Kept in one file on purpose:
 *  - a non-developer can review and correct the wording without touching code;
 *  - nothing can be hard-coded into a screen and quietly go untranslated;
 *  - adding a second language later means adding one more file, not a rewrite.
 *
 * Keys are English. Values are Mongolian.
 */
export const mn = {
  app: {
    name: 'Эмчийн уулзалтын бүртгэл',
    shortName: 'Уулзалтын бүртгэл',
  },

  common: {
    loading: 'Ачааллаж байна...',
    retry: 'Дахин оролдох',
    cancel: 'Болих',
    save: 'Хадгалах',
    close: 'Хаах',
    search: 'Хайх',
    filter: 'Шүүлтүүр',
    all: 'Бүгд',
    yes: 'Тийм',
    no: 'Үгүй',
    back: 'Буцах',
    next: 'Дараах',
    confirm: 'Баталгаажуулах',
    error: 'Алдаа гарлаа',
    empty: 'Мэдээлэл олдсонгүй',
    notImplemented: 'Хараахан хэрэгжээгүй',
    notImplementedHint: 'Энэ хэсэг дараагийн шатанд нэмэгдэнэ.',
    offline: 'Интернэт холболт алга',
    offlineHint: 'Хадгалсан мэдээллийг харуулж байна.',
    active: 'Идэвхтэй',
    inactive: 'Идэвхгүй',
    unknown: 'Тодорхойгүй',
    optional: 'заавал биш',
    required: 'заавал',
  },

  auth: {
    title: 'Нэвтрэх',
    subtitle: 'Байгууллагын ажлын и-мэйлээрээ нэвтэрнэ үү.',
    emailLabel: 'Ажлын и-мэйл хаяг',
    emailPlaceholder: 'ner@monos.mn',
    sendCode: 'Код авах',
    sendingCode: 'Код илгээж байна...',
    codeLabel: 'И-мэйлээр ирсэн 6 оронтой код',
    codePlaceholder: '000000',
    verify: 'Нэвтрэх',
    verifying: 'Шалгаж байна...',
    resendCode: 'Кодыг дахин илгээх',
    resendIn: (seconds: number) => `Дахин илгээх (${seconds} сек)`,
    changeEmail: 'Өөр и-мэйл хаяг оруулах',
    codeSentTo: (email: string) => `${email} хаяг руу код илгээлээ.`,
    signOut: 'Гарах',
    signOutConfirm: 'Та системээс гарахдаа итгэлтэй байна уу?',

    // Error messages. Each one tells the person what to DO next.
    errorDomainNotAllowed:
      'Энэ и-мэйл хаягаар нэвтрэх боломжгүй. Зөвхөн байгууллагын ажлын и-мэйл хаяг ашиглана уу.',
    errorNotProvisioned:
      'Таны бүртгэл идэвхжээгүй байна. Системийн администраторт хандана уу.',
    errorInvalidCode: 'Код буруу эсвэл хугацаа нь дууссан байна. Дахин оролдоно уу.',
    errorNetwork: 'Интернэт холболтоо шалгаад дахин оролдоно уу.',
    errorGeneric: 'Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу.',
    errorEmailRequired: 'И-мэйл хаягаа оруулна уу.',
    errorEmailInvalid: 'И-мэйл хаяг буруу байна.',
    errorCodeRequired: 'Кодоо оруулна уу.',
  },

  roles: {
    representative: 'Эмнэлгийн төлөөлөгч',
    manager: 'Менежер',
    administrator: 'Администратор',
  },

  tabs: {
    home: 'Нүүр',
    today: 'Өнөөдөр',
    week: 'Хуваарь',
    clinics: 'Эмнэлэг',
    doctors: 'Эмч',
    brands: 'Брэнд',
    kpi: 'KPI',
    settings: 'Тохиргоо',
    dashboard: 'Самбар',
    exceptions: 'Хүсэлт',
    users: 'Хэрэглэгч',
    masterData: 'Мастер дата',
    audit: 'Аудит',
  },

  home: {
    greeting: (name: string) => `Сайн байна уу, ${name}`,
    todayPlanned: 'Өнөөдрийн төлөвлөгөөт уулзалт',
    completedToday: 'Өнөөдөр хийгдсэн',
    remainingToday: 'Үлдсэн',
    weekKpi: 'Энэ долоо хоногийн биелэлт',
    pendingFollowUps: 'Хүлээгдэж буй дараагийн үйлдэл',
    syncIssues: 'Синк хийгдээгүй бичлэг',
    myBrands: 'Миний хариуцсан брэнд',
    quickLinks: 'Түргэн холбоос',
    goToToday: 'Өнөөдрийн маршрут',
  },

  clinics: {
    title: 'Эмнэлгүүд',
    searchPlaceholder: 'Эмнэлгийн нэр, дүүргээр хайх',
    districtFilter: 'Дүүрэг',
    count: (n: number) => `${n} эмнэлэг`,
    type: 'Төрөл',
    district: 'Дүүрэг',
    address: 'Хаяг',
    phone: 'Утас',
    radius: 'Зөвшөөрөгдөх зай',
    coordinates: 'Байршил',
    notes: 'Тэмдэглэл',
    doctorsHere: 'Энд ажилладаг эмч нар',
    openInMap: 'Газрын зураг дээр нээх',
    radiusExplain: (m: number) =>
      `Уулзалт эхлүүлэхийн тулд эмнэлгээс ${m} метрийн дотор байх шаардлагатай.`,
    empty: 'Эмнэлэг олдсонгүй.',
  },

  doctors: {
    title: 'Эмч нар',
    searchPlaceholder: 'Эмчийн нэр, мэргэжлээр хайх',
    count: (n: number) => `${n} эмч`,
    speciality: 'Мэргэжил',
    phone: 'Утас',
    email: 'И-мэйл',
    worksAt: 'Ажилладаг эмнэлэг',
    department: 'Тасаг',
    room: 'Өрөө',
    availableDays: 'Ажиллах өдөр',
    availableHours: 'Ажиллах цаг',
    professionalNotes: 'Мэргэжлийн тэмдэглэл',
    visitHistory: 'Уулзалтын түүх',
    noPatientInfo: 'Өвчтөний талаарх мэдээлэл оруулахыг хориглоно.',
    empty: 'Эмч олдсонгүй.',
  },

  brands: {
    title: 'Брэнд ба бүтээгдэхүүн',
    myBrands: 'Миний хариуцсан брэнд',
    otherBrands: 'Бусад брэнд',
    allBrands: 'Бүх брэнд',
    category: 'Ангилал',
    products: 'Бүтээгдэхүүн',
    productCount: (n: number) => `${n} бүтээгдэхүүн`,
    sku: 'Код',
    assignedSince: (date: string) => `${date}-нээс хариуцаж байна`,
    empty: 'Брэнд олдсонгүй.',
  },

  settings: {
    title: 'Тохиргоо',
    account: 'Хэрэглэгчийн мэдээлэл',
    name: 'Нэр',
    email: 'И-мэйл',
    role: 'Эрх',
    phone: 'Утас',
    manager: 'Менежер',

    privacy: 'Нууцлал ба байршил',
    locationPolicy:
      'Энэ апп таны байршлыг БАЙНГА хянахгүй. Байршлыг зөвхөн дараах 3 үед л уншина: уулзалт эхлүүлэх, уулзалт дуусгах, өөрөө чөлөөлөх хүсэлт илгээх үед.',
    noBackgroundTracking: 'Ард ажиллах байршил хяналт: унтраалттай',
    audioRecording: 'Дуу хураах',
    audioRecordingOff: 'Идэвхгүй — хэрэгжээгүй',
    audioRecordingExplain:
      'Энэ хувилбарт дуу хураах функц огт байхгүй. Ирээдүйд нэмэгдвэл эмчийн зөвшөөрөл заавал шаардагдана.',

    system: 'Систем',
    timezone: 'Цагийн бүс',
    timezoneValue: 'Улаанбаатар (UTC+8)',
    appVersion: 'Аппын хувилбар',
    syncStatus: 'Синк төлөв',
    clearCache: 'Түр хадгалсан мэдээллийг цэвэрлэх',
    clearCacheConfirm:
      'Хадгалсан мэдээллийг устгах уу? Интернэттэй үед дахин татагдана. Илгээгдээгүй бичлэг устахгүй.',
  },

  sync: {
    synced: 'Синк хийгдсэн',
    pending: 'Хүлээгдэж буй',
    failed: 'Синк амжилтгүй',
    title: 'Синк төлөв',
  },

  errors: {
    loadFailed: 'Мэдээлэл татахад алдаа гарлаа.',
    noPermission: 'Танд энэ үйлдлийг хийх эрх алга.',
    sessionExpired: 'Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.',
    configMissing:
      'Аппын тохиргоо дутуу байна. Администраторт хандана уу. (.env файл бөглөгдөөгүй)',
  },
} as const;

export type Strings = typeof mn;
