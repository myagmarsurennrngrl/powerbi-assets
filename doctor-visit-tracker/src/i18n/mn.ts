/**
 * Every piece of Mongolian user-facing text lives here.
 *
 * Keys are English so developers can search them; values are Mongolian so the
 * whole interface can be reviewed and corrected by a Mongolian speaker in one
 * file, without touching any screen code.
 */

export const mn = {
  appName: 'Эмч уулзалтын бүртгэл',

  // ---------------------------------------------------------------- common
  common: {
    loading: 'Ачааллаж байна…',
    retry: 'Дахин оролдох',
    cancel: 'Болих',
    save: 'Хадгалах',
    saving: 'Хадгалж байна…',
    close: 'Хаах',
    back: 'Буцах',
    search: 'Хайх',
    searchPlaceholder: 'Нэрээр хайх…',
    noData: 'Мэдээлэл алга',
    error: 'Алдаа гарлаа',
    yes: 'Тийм',
    no: 'Үгүй',
    active: 'Идэвхтэй',
    inactive: 'Идэвхгүй',
    all: 'Бүгд',
    of: '/',
    required: 'Заавал бөглөнө',
    optional: 'Заавал бус',
    confirm: 'Баталгаажуулах',
    notImplemented: 'Хараахан хэрэгжээгүй',
    notImplementedHint: 'Энэ хэсэг дараагийн шатанд нэмэгдэнэ.',
    offlineBanner: 'Офлайн горим — хадгалсан мэдээлэл харагдаж байна',
    unknown: 'Тодорхойгүй',
    metres: 'м',
    minutes: 'мин',
  },

  // ------------------------------------------------------------------ auth
  auth: {
    loginTitle: 'Нэвтрэх',
    loginSubtitle: 'Байгууллагын ажлын и-мэйл хаягаа оруулна уу.',
    emailLabel: 'Ажлын и-мэйл хаяг',
    emailPlaceholder: 'ner@company.mn',
    sendCode: 'Нэвтрэх код авах',
    sendingCode: 'Код илгээж байна…',
    verifyTitle: 'Баталгаажуулах',
    verifySubtitle: 'Таны и-мэйл рүү илгээсэн 6 оронтой кодыг оруулна уу.',
    codeLabel: 'Баталгаажуулах код',
    verify: 'Нэвтрэх',
    verifying: 'Шалгаж байна…',
    resend: 'Кодыг дахин илгээх',
    resendIn: (seconds: number) => `Дахин илгээх боломжтой: ${seconds} сек`,
    signOut: 'Гарах',
    signOutConfirm: 'Та системээс гарахдаа итгэлтэй байна уу?',

    errorInvalidEmail: 'И-мэйл хаяг буруу байна.',
    errorDomainNotAllowed:
      'Энэ и-мэйл хаягаар нэвтрэх боломжгүй. Зөвхөн байгууллагын батлагдсан хаяг ашиглана.',
    errorNotProvisioned:
      'Таны хаяг системд бүртгэгдээгүй байна. Администратортай холбогдоно уу.',
    errorInactive: 'Таны эрх идэвхгүй байна. Администратортай холбогдоно уу.',
    errorWrongCode: 'Код буруу эсвэл хугацаа нь дууссан байна.',
    errorTooManyRequests: 'Хэт олон удаа оролдлоо. Хэсэг хүлээгээд дахин оролдоно уу.',
    errorNetwork: 'Интернэт холболт байхгүй байна. Нэвтрэхийн тулд холболт шаардлагатай.',
    errorGeneric: 'Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу.',
  },

  // ------------------------------------------------------------------ roles
  roles: {
    representative: 'Эмнэлгийн төлөөлөгч',
    manager: 'Менежер',
    administrator: 'Администратор',
  },

  // ------------------------------------------------------------------- tabs
  tabs: {
    home: 'Нүүр',
    today: 'Өнөөдөр',
    plan: 'Төлөвлөгөө',
    directory: 'Лавлах',
    kpi: 'KPI',
    dashboard: 'Самбар',
    exceptions: 'Онцгой',
    masterData: 'Мэдээлэл',
    users: 'Хэрэглэгч',
    settings: 'Тохиргоо',
  },

  // ------------------------------------------------------------------- home
  home: {
    greeting: (name: string) => `Сайн байна уу, ${name}`,
    yourRole: 'Таны эрх',
    quickLinks: 'Түргэн холбоос',
    referenceData: 'Лавлах мэдээлэл',
    clinicsCount: 'Эмнэлэг',
    doctorsCount: 'Эмч',
    brandsCount: 'Брэнд',
    productsCount: 'Бүтээгдэхүүн',
    myBrands: 'Миний хариуцсан брэнд',
    myBrandsEmpty: 'Танд одоогоор брэнд хуваарилагдаагүй байна.',
    staffCount: 'Ажилтан',
    comingSoonTitle: 'Дараагийн шатууд',
  },

  // ---------------------------------------------------------------- clinics
  clinics: {
    title: 'Эмнэлгүүд',
    detailTitle: 'Эмнэлгийн дэлгэрэнгүй',
    district: 'Дүүрэг',
    address: 'Хаяг',
    type: 'Төрөл',
    phone: 'Утас',
    coordinates: 'Байршил',
    radius: 'Зөвшөөрөгдөх зай',
    notes: 'Тэмдэглэл',
    doctorsHere: 'Энд ажилладаг эмч нар',
    openInMaps: 'Газрын зураг дээр нээх',
    empty: 'Эмнэлэг олдсонгүй.',
    types: {
      public_hospital: 'Улсын эмнэлэг',
      private_hospital: 'Хувийн эмнэлэг',
      clinic: 'Клиник',
      dermatology_center: 'Арьс судлалын төв',
      pharmacy_chain: 'Эмийн сүлжээ',
      other: 'Бусад',
    },
  },

  // ---------------------------------------------------------------- doctors
  doctors: {
    title: 'Эмч нар',
    detailTitle: 'Эмчийн профайл',
    speciality: 'Мэргэжил',
    phone: 'Утас',
    email: 'И-мэйл',
    clinics: 'Ажилладаг эмнэлэг',
    department: 'Тасаг',
    room: 'Өрөө',
    availableDays: 'Ажиллах өдрүүд',
    availableHours: 'Цаг',
    professionalNotes: 'Мэргэжлийн тэмдэглэл',
    visitHistory: 'Уулзалтын түүх',
    empty: 'Эмч олдсонгүй.',
    noPatientData: 'Өвчтөний талаарх мэдээлэл оруулахыг хатуу хориглоно.',
  },

  // ----------------------------------------------------------------- brands
  brands: {
    title: 'Брэнд ба бүтээгдэхүүн',
    products: 'Бүтээгдэхүүн',
    category: 'Ангилал',
    sku: 'Код',
    assignedToMe: 'Надад хуваарилагдсан',
    empty: 'Брэнд олдсонгүй.',
    productCount: (n: number) => `${n} бүтээгдэхүүн`,
  },

  // ------------------------------------------------------------------ admin
  admin: {
    usersTitle: 'Хэрэглэгчийн удирдлага',
    masterDataTitle: 'Үндсэн мэдээллийн удирдлага',
    addUser: 'Хэрэглэгч нэмэх',
    editUser: 'Хэрэглэгч засах',
    fullName: 'Овог нэр',
    email: 'И-мэйл',
    employeeCode: 'Ажилтны код',
    role: 'Эрх',
    phone: 'Утас',
    activeStatus: 'Идэвхтэй эсэх',
    deactivate: 'Идэвхгүй болгох',
    activate: 'Идэвхжүүлэх',
    deactivateConfirm:
      'Идэвхгүй болгосон хэрэглэгч системд нэвтрэх боломжгүй болно. Үргэлжлүүлэх үү?',
    cannotChangeOwnRole: 'Та өөрийн эрхээ өөрчлөх боломжгүй.',
    userCreated: 'Хэрэглэгч үүслээ. Тэр хүн ажлын и-мэйлээрээ нэвтэрч орно.',
    userUpdated: 'Хэрэглэгчийн мэдээлэл шинэчлэгдлээ.',
    addClinic: 'Эмнэлэг нэмэх',
    editClinic: 'Эмнэлэг засах',
    addDoctor: 'Эмч нэмэх',
    editDoctor: 'Эмч засах',
    addBrand: 'Брэнд нэмэх',
    addProduct: 'Бүтээгдэхүүн нэмэх',
    latitude: 'Өргөрөг',
    longitude: 'Уртраг',
    radiusMetres: 'Геофенсийн радиус (метр)',
    radiusHint: 'Анхдагч 150 м. Том эмнэлэгт эсвэл GPS муутай газарт нэмэгдүүлнэ.',
    saved: 'Хадгалагдлаа.',
    duplicateClinic: 'Ийм нэртэй эмнэлэг тухайн дүүрэгт аль хэдийн бүртгэгдсэн байна.',
    duplicateDoctor: 'Ийм нэр, мэргэжилтэй эмч аль хэдийн бүртгэгдсэн байна.',
    duplicateBrand: 'Ийм нэртэй брэнд аль хэдийн бүртгэгдсэн байна.',
    duplicateSku: 'Ийм кодтой бүтээгдэхүүн аль хэдийн бүртгэгдсэн байна.',
    invalidCoordinates: 'Байршлын координат буруу байна.',
    coordinatesOutsideMongolia: 'Анхаар: энэ координат Монгол улсын гадна байна.',
  },

  // --------------------------------------------------------------- settings
  settings: {
    title: 'Тохиргоо',
    account: 'Хаяг',
    appVersion: 'Аппын хувилбар',
    privacy: 'Байршлын нууцлал',
    privacyTitle: 'Байршлын нууцлал',
    syncStatus: 'Синк төлөв',
    auditLog: 'Аудит бүртгэл',
    server: 'Сервер',
    connected: 'Холбогдсон',
    disconnected: 'Холбогдоогүй',
  },

  privacy: {
    heading: 'Таны байршлыг хэрхэн ашигладаг вэ',
    bullet1:
      'Апп таныг тасралтгүй хянадаггүй. Ард ажиллах байршлын хяналт огт байхгүй.',
    bullet2:
      'Байршлыг зөвхөн 3 үед авна: уулзалт эхлүүлэх, уулзалт дуусгах, өөрөө онцгой тохиолдол илгээх үед.',
    bullet3: 'Нэг уулзалтад дээд тал нь 3 цэг хадгалагдана. Замын мөр хадгалагддаггүй.',
    bullet4: 'Байршлын өгөгдөл 2 жилийн дараа устгагдана. Уулзалтын бүртгэл үлдэнэ.',
    bullet5: 'Өвчтөний талаарх ямар ч мэдээлэл энэ аппад бүртгэгдэхгүй.',
    bullet6: 'Дуу хураах боломж идэвхгүй байна.',
  },

  // ------------------------------------------------------------------ setup
  setup: {
    title: 'Тохиргоо дутуу байна',
    body:
      'Аппын .env файл бөглөгдөөгүй эсвэл буруу байна. docs/setup/01-SETUP-FOR-BEGINNERS.md файлыг үзнэ үү.',
  },
} as const;

export type Mn = typeof mn;
