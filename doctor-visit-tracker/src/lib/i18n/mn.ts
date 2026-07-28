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
    errorRateLimited:
      'Хэт олон удаа код хүслээ. Хэдэн минут хүлээгээд дахин оролдоно уу. (Supabase-ийн үнэгүй и-мэйл илгээгч цагт хэдхэн захидал л зөвшөөрдөг.)',
    errorDetailLabel: 'Серверийн хариу (администраторт үзүүлнэ үү):',
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

  today: {
    title: 'Өнөөдрийн маршрут',
    noVisits: 'Өнөөдөр төлөвлөсөн уулзалт алга.',
    noVisitsHint: 'Долоо хоногийн хуваариасаа шалгана уу.',
    order: (n: number) => `${n}-р уулзалт`,
    plannedAt: (time: string) => `Товлосон цаг: ${time}`,
    distance: 'Зай',
    distanceUnknown: 'Зай тодорхойгүй',
    showDistance: 'Зайг харах',
    refreshDistance: 'Зайг шинэчлэх',
    locating: 'Байршил тодорхойлж байна...',
    openInMap: 'Газрын зураг',
    startVisit: 'Уулзалт эхлүүлэх',
    exception: 'Чөлөөлөх',
    summary: (done: number, total: number) => `${total} уулзалтаас ${done} нь хийгдсэн`,
    locationWhyTitle: 'Байршил юунд хэрэгтэй вэ?',
    locationWhy:
      'Эмнэлгээс хэр зайд байгааг харуулахад л ашиглана. Товч дархад л нэг удаа уншина.',
    locationDenied: 'Байршлын зөвшөөрөл олгогдоогүй байна. Утасны тохиргооноос зөвшөөрнө үү.',
    locationServicesOff: 'Утасны байршил унтраалттай байна. Асаагаад дахин оролдоно уу.',
    locationUnavailable: 'Байршил тодорхойлох боломжгүй байна. Задгай газар очиж дахин оролдоно уу.',
    locationTimeout: 'Байршил тодорхойлоход хугацаа хэтэрлээ. Дахин оролдоно уу.',
  },

  week: {
    title: 'Долоо хоногийн хуваарь',
    thisWeek: 'Энэ долоо хоног',
    previousWeek: 'Өмнөх',
    nextWeek: 'Дараах',
    weekLabel: (year: number, week: number) => `${year} оны ${week}-р долоо хоног`,
    noPlan: 'Энэ долоо хоногт төлөвлөгөө байхгүй байна.',
    createPlan: 'Төлөвлөгөө үүсгэх',
    editPlan: 'Төлөвлөгөө засах',
    viewPlan: 'Төлөвлөгөө харах',
    visitsOnDay: (n: number) => `${n} уулзалт`,
    noVisitsOnDay: 'Уулзалт алга',
    clinicsOnDay: (n: number) => `${n} эмнэлэг`,
    totalVisits: (n: number) => `Нийт ${n} уулзалт`,
    deadline: (when: string) => `Илгээх эцсийн хугацаа: ${when}`,
    deadlinePassed: 'Илгээх хугацаа дууссан',
    reviewComment: 'Менежерийн тайлбар',
  },

  planBuilder: {
    title: 'Төлөвлөгөө боловсруулах',
    addVisit: 'Уулзалт нэмэх',
    step1: '1. Өдөр сонгох',
    step2: '2. Эмнэлэг сонгох',
    step3: '3. Эмч сонгох',
    step4: '4. Брэнд сонгох',
    step5: '5. Зорилго ба цаг',
    selectDate: 'Өдөр',
    selectClinic: 'Эмнэлэг',
    selectDoctors: 'Уулзах эмч',
    selectBrands: 'Ярилцах брэнд',
    objective: 'Уулзалтын зорилго',
    objectivePlaceholder: 'Жишээ: Шинэ бүтээгдэхүүн танилцуулах',
    plannedTime: 'Товлосон цаг (24 цагийн формат)',
    plannedTimePlaceholder: '09:00',
    save: 'Уулзалт хадгалах',
    saving: 'Хадгалж байна...',
    submit: 'Төлөвлөгөө илгээх',
    submitting: 'Илгээж байна...',
    submitConfirm: 'Төлөвлөгөөг менежерт илгээх үү? Илгээсний дараа засах боломжгүй.',
    submitted: 'Төлөвлөгөө амжилттай илгээгдлээ.',
    visitAdded: 'Уулзалт нэмэгдлээ.',
    removeVisit: 'Уулзалт хасах',
    removeVisitConfirm: 'Энэ уулзалтыг төлөвлөгөөнөөс хасах уу?',
    notEditable: 'Энэ төлөвлөгөөг засах боломжгүй байна.',
    notEditableHint: 'Илгээгдсэн эсвэл хугацаа нь дууссан байна.',
    onlyMyBrands: 'Зөвхөн таны хариуцсан брэндүүд харагдана.',
    noDoctorsAtClinic: 'Энэ эмнэлэгт бүртгэлтэй эмч алга.',
    errorNoClinic: 'Эмнэлэг сонгоно уу.',
    errorNoDoctor: 'Дор хаяж нэг эмч сонгоно уу.',
    errorNoBrand: 'Дор хаяж нэг брэнд сонгоно уу.',
    errorNoObjective: 'Уулзалтын зорилгыг бичнэ үү.',
    errorBadTime: 'Цагийг 09:00 хэлбэрээр оруулна уу.',
    emptyPlan: 'Одоогоор уулзалт нэмээгүй байна.',
  },

  startVisit: {
    title: 'Уулзалт эхлүүлэх',
    checking: 'Байршил шалгаж байна...',
    recheck: 'Дахин шалгах',
    ready: 'Уулзалт эхлүүлэхэд бэлэн',
    notReady: 'Одоогоор эхлүүлэх боломжгүй',
    confirmAndStart: 'Баталгаажуулж эхлүүлэх',
    starting: 'Эхлүүлж байна...',

    distanceLabel: 'Эмнэлгээс хүртэлх зай',
    radiusLabel: 'Зөвшөөрөгдөх зай',
    accuracyLabel: 'GPS нарийвчлал',
    accuracyThresholdLabel: 'Шаардлагатай нарийвчлал',

    // The eight conditions, in the order the server reports them.
    condOwner: 'Энэ уулзалт танд хамаарна',
    condToday: 'Өнөөдрийн уулзалт мөн',
    condStatus: 'Уулзалт эхлээгүй байна',
    condNoOther: 'Өөр уулзалт үргэлжлээгүй байна',
    condLocation: 'Байршил тодорхойлогдсон',
    condAccuracy: 'GPS нарийвчлал хангалттай',
    condRadius: 'Эмнэлгийн ойролцоо байна',

    reasonNotOwner: 'Энэ уулзалт танд хамааралгүй байна.',
    reasonNotToday: 'Энэ уулзалт өөр өдөр товлогдсон байна.',
    reasonWrongStatus: 'Энэ уулзалтыг эхлүүлэх боломжгүй төлөвтэй байна.',
    reasonOtherInProgress: 'Танд үргэлжилж буй өөр уулзалт байна. Түүнийг эхлээд дуусгана уу.',
    reasonNoLocation: 'Байршил тодорхойлогдоогүй байна.',
    reasonPoorAccuracy: 'GPS-ийн нарийвчлал хангалтгүй байна. Задгай газар очиж дахин оролдоно уу.',
    reasonOutsideRadius: 'Та эмнэлгээс хэт хол байна.',

    exceptionHint:
      'Хэрэв та эмнэлэг дээрээ байгаа боловч эхлүүлж чадахгүй байвал чөлөөлөх хүсэлт илгээнэ үү. Зөвхөн менежер зөвшөөрнө.',
    locationNotice:
      'Байршлыг зөвхөн энэ шалгалтад л уншина. Апп таны байршлыг байнга хянахгүй.',
  },

  activeVisit: {
    title: 'Идэвхтэй уулзалт',
    elapsed: 'Үргэлжилж буй хугацаа',
    startedAt: (time: string) => `${time}-д эхэлсэн`,
    finish: 'Уулзалт дуусгах',
    finishing: 'Дуусгаж байна...',
    finishConfirm: 'Уулзалтыг дуусгах уу? Байршил болон цаг бүртгэгдэнэ.',
    checkedOut: 'Уулзалт дууслаа. Тайлангаа бөглөнө үү.',
    awaitingReport: 'Тайлан бөглөгдөөгүй',
    awaitingReportHint:
      'Гарах цаг болон байршил бүртгэгдсэн. Уулзалтын тайлан бөглөх хэсэг 4-р шатанд нэмэгдэнэ.',
    noActiveVisit: 'Идэвхтэй уулзалт алга.',
    banner: 'Танд үргэлжилж буй уулзалт байна',
    openActive: 'Нээх',
  },

  visitDetail: {
    title: 'Уулзалтын дэлгэрэнгүй',
    plannedFor: 'Товлосон',
    clinic: 'Эмнэлэг',
    doctors: 'Уулзах эмч',
    brands: 'Ярилцах брэнд',
    products: 'Бүтээгдэхүүн',
    objective: 'Зорилго',
    status: 'Төлөв',
    order: 'Дараалал',
    statusHistory: 'Төлөвийн түүх',
  },

  completeVisit: {
    title: 'Уулзалт дуусгах',
    subtitle: 'Уулзалтын тайлангаа бөглөнө үү.',
    meetingStatus: 'Уулзалтын төлөв',
    doctorsMet: 'Уулзсан эмч',
    brandsDiscussed: 'Ярилцсан брэнд',
    productsDiscussed: 'Ярилцсан бүтээгдэхүүн',
    objective: 'Уулзалтын зорилго',
    outcome: 'Үр дүн',
    doctorFeedback: 'Эмчийн санал хүсэлт',
    interestLevel: 'Сонирхлын түвшин',
    samples: 'Өгсөн сорьц',
    materials: 'Өгсөн материал',
    followUpRequired: 'Дараагийн уулзалт шаардлагатай юу?',
    followUpDate: 'Дараагийн уулзалтын огноо',
    nextAction: 'Дараагийн үйлдэл',
    repSummary: 'Товч тайлбар',

    saveDraft: 'Ноорог хадгалах',
    savingDraft: 'Хадгалж байна...',
    draftSaved: 'Ноорог хадгалагдлаа.',
    draftQueued: 'Утсанд хадгаллаа — интернэттэй болмогц илгээгдэнэ.',
    submit: 'Тайлан илгээх',
    submitting: 'Илгээж байна...',
    submitConfirm:
      'Тайланг илгээх үү? Илгээсний дараа засах боломжгүй. Залруулга шаардлагатай бол менежерт хандана.',
    submitted: 'Тайлан амжилттай илгээгдлээ.',
    submittedQueued:
      'Тайлан утсанд хадгалагдлаа. Интернэттэй болмогц автоматаар илгээгдэнэ. Төлөвийг «Синк төлөв» хэсгээс шалгана уу.',

    notCheckedOut: 'Эхлээд уулзалтаа дуусгана уу.',
    incomplete: 'Дараах талбарууд дутуу байна:',
    onlyMyBrands: 'Зөвхөн таны хариуцсан брэндүүд.',
    noPatientInfo: 'Өвчтөний талаарх мэдээлэл бичихийг хориглоно.',
    optionalIfNotMet: 'Эмчтэй уулзаагүй бол бөглөх шаардлагагүй.',

    // Field names, used when the server reports what is missing.
    fieldNames: {
      meeting_status: 'Уулзалтын төлөв',
      doctors: 'Уулзсан эмч',
      brands: 'Ярилцсан брэнд',
      doctor_feedback: 'Эмчийн санал хүсэлт',
      interest_level: 'Сонирхлын түвшин',
      objective: 'Уулзалтын зорилго',
      outcome: 'Үр дүн',
      next_action: 'Дараагийн үйлдэл',
      rep_summary: 'Товч тайлбар',
      follow_up_required: 'Дараагийн уулзалт шаардлагатай эсэх',
      follow_up_date: 'Дараагийн уулзалтын огноо',
      check_out: 'Уулзалт дуусгах',
      visit: 'Уулзалт',
    } as Record<string, string>,
  },

  history: {
    title: 'Уулзалтын түүх',
    count: (n: number) => `${n} уулзалт`,
    empty: 'Уулзалтын түүх алга.',
    emptyFiltered: 'Шүүлтүүрт тохирох уулзалт олдсонгүй.',
    filters: 'Шүүлтүүр',
    clearFilters: 'Шүүлтүүр цэвэрлэх',
    filterRep: 'Төлөөлөгч',
    filterBrand: 'Брэнд',
    filterClinic: 'Эмнэлэг',
    filterOutcome: 'Үр дүн',
    filterPeriod: 'Хугацаа',
    periodAll: 'Бүх хугацаа',
    period30: 'Сүүлийн 30 хоног',
    period90: 'Сүүлийн 90 хоног',
    period365: 'Сүүлийн 1 жил',
    visitedBy: (name: string) => `Төлөөлөгч: ${name}`,
    duration: 'Үргэлжилсэн хугацаа',
    addenda: (n: number) => `${n} залруулга`,
    readOnly: 'Энэ түүх зөвхөн уншихад зориулагдсан.',
    addendumTitle: 'Залруулга',
    addAddendum: 'Залруулга нэмэх',
    addendumText: 'Залруулгын агуулга',
    addendumReason: 'Шалтгаан',
    addendumSave: 'Залруулга хадгалах',
    addendumSaved: 'Залруулга нэмэгдлээ.',
    addendumQueued: 'Залруулга утсанд хадгалагдлаа. Интернэттэй болмогц илгээгдэнэ.',
    addendumNote: 'Анхны бичлэг өөрчлөгдөхгүй. Залруулга тусад нь хадгалагдана.',
  },

  exception: {
    title: 'Чөлөөлөх хүсэлт',
    subtitle: 'Яагаад энэ уулзалт төлөвлөснөөр болоогүйг тайлбарлана уу.',
    reason: 'Шалтгаан',
    explanation: 'Дэлгэрэнгүй тайлбар',
    explanationPlaceholder: 'Жишээ: Эмнэлэг дотор GPS барихгүй байна.',
    attachLocation: 'Одоогийн байршлыг хавсаргах',
    attachLocationHint:
      'Заавал биш. Эмнэлэг дээр байгаа боловч эхлүүлж чадахгүй байгаа бол хавсаргавал менежерт тустай.',
    locationAttached: (m: string) => `Байршил хавсаргасан (эмнэлгээс ${m})`,
    submit: 'Хүсэлт илгээх',
    submitting: 'Илгээж байна...',
    submitted: 'Хүсэлт илгээгдлээ. Менежер шийдвэрлэнэ.',
    submittedQueued:
      'Хүсэлт утсанд хадгалагдлаа. Интернэттэй болмогц илгээгдэж, дараа нь менежер шийдвэрлэнэ.',
    onlyManagerApproves: 'Зөвхөн менежер зөвшөөрнө. Та өөрөө зөвшөөрөх боломжгүй.',
    kpiWarning:
      'Зөвшөөрөгдсөн ч зарим шалтгаан KPI-д тооцогдсон хэвээр байна. Менежер шийдвэрлэхдээ үүнийг харна.',
    errorNoReason: 'Шалтгаанаа сонгоно уу.',
    errorNoExplanation: 'Тайлбараа бичнэ үү.',

    // Approval queue
    queueTitle: 'Хүлээгдэж буй хүсэлт',
    queueEmpty: 'Хүлээгдэж буй хүсэлт алга.',
    requestedAt: 'Илгээсэн',
    requestedBy: 'Илгээсэн ажилтан',
    distanceAtRequest: 'Хүсэлт илгээх үеийн зай',
    willExcludeKpi: 'Зөвшөөрвөл KPI-аас хасагдана',
    willNotExcludeKpi: 'Зөвшөөрсөн ч KPI-д тооцогдоно',
    approve: 'Зөвшөөрөх',
    reject: 'Татгалзах',
    comment: 'Тайлбар',
    commentRequiredOnReject: 'Татгалзахдаа шалтгаанаа бичнэ үү.',
    approved: 'Зөвшөөрлөө.',
    rejected: 'Татгалзлаа.',
    confirmApprove: 'Энэ хүсэлтийг зөвшөөрөх үү?',
    confirmReject: 'Энэ хүсэлтээс татгалзах уу?',
  },

  kpi: {
    title: 'Миний KPI',
    teamTitle: 'Багийн KPI',
    thisWeek: 'Энэ долоо хоног',
    lastWeek: 'Өнгөрсөн долоо хоног',
    thisMonth: 'Энэ сар',
    lastMonth: 'Өнгөрсөн сар',
    provisional: 'Урьдчилсан',
    provisionalHint: 'Хугацаа дуусаагүй тул тоо өөрчлөгдөж болно.',
    ruleVersion: (n: number) => `KPI дүрмийн хувилбар ${n}`,

    completion: 'Биелэлтийн хувь',
    completionNotApplicable: 'Хамаарахгүй',
    completionNotApplicableHint:
      'Энэ хугацаанд тооцох уулзалт байхгүй байна. Тэг хувь гэсэн үг биш.',

    planned: 'Төлөвлөсөн',
    completed: 'Биелсэн',
    missed: 'Хийгдээгүй',
    approvedCancellations: 'Зөвшөөрөгдсөн цуцлалт',
    unapprovedCancellations: 'Зөвшөөрөгдөөгүй цуцлалт',
    unplanned: 'Төлөвлөгөөт бус',
    unplannedHint: 'Энэ тоо биелэлтийн хувьд ороогүй, тусад нь харуулав.',
    eligible: 'Тооцох уулзалт',
    avgDuration: 'Дундаж үргэлжлэх хугацаа',
    onTime: 'Цагтаа эхэлсэн',
    doctorCoverage: 'Эмчийн хамрал',
    clinicCoverage: 'Эмнэлгийн хамрал',
    followUpCompletion: 'Дараагийн үйлдлийн биелэлт',
    brandActivity: 'Брэндийн идэвх',
    brandVisits: (n: number) => `${n} уулзалт`,
    noData: 'Энэ хугацаанд мэдээлэл алга.',
    howCalculated: 'Хэрхэн тооцсон бэ?',
    formula: 'Биелэлт = Биелсэн уулзалт ÷ Тооцох уулзалт × 100',
  },

  dashboard: {
    title: 'Менежерийн самбар',
    period: 'Хугацаа',
    last7: 'Сүүлийн 7 хоног',
    last28: 'Сүүлийн 28 хоног',
    last90: 'Сүүлийн 90 хоног',

    teamCompletion: 'Багийн биелэлт',
    teamRanking: 'Төлөөлөгчдийн эрэмбэ',
    missedVisits: 'Хийгдээгүй уулзалт',
    pendingExceptions: 'Хүлээгдэж буй хүсэлт',
    needsReview: 'Шалгах шаардлагатай уулзалт',
    needsReviewHint:
      'Энэ бол буруутгах жагсаалт биш. Хэвийн тайлбартай байж болно — шалгаж үзэхэд л зориулав.',
    uncoveredClinics: 'Очоогүй эмнэлэг',
    uncoveredDoctors: 'Уулзаагүй эмч',
    recentVisits: 'Сүүлийн уулзалтууд',
    lastVisited: 'Сүүлд очсон',
    never: 'Хэзээ ч очоогүй',
    export: 'CSV экспорт',
    exporting: 'Бэлтгэж байна...',
    exportDone: (n: number) => `${n} мөр экспортлоход бэлэн боллоо.`,
    exportAudited: 'Экспорт бүрийг аудит логт бүртгэнэ.',
    noReviewItems: 'Шалгах зүйл алга.',
  },

  audit: {
    title: 'Аудит лог',
    filterAction: 'Үйлдэл',
    empty: 'Бичлэг алга.',
    loadMore: 'Илүү ихийг үзэх',
    readOnly: 'Аудит логийг хэн ч засах, устгах боломжгүй.',
    actor: 'Хэрэглэгч',
    when: 'Хэзээ',
    what: 'Юу',
    actions: {
      login: 'Нэвтэрсэн',
      logout: 'Гарсан',
      login_denied_domain: 'Нэвтрэх татгалзсан',
      plan_created: 'Төлөвлөгөө үүсгэсэн',
      plan_changed: 'Төлөвлөгөө өөрчилсөн',
      plan_submitted: 'Төлөвлөгөө илгээсэн',
      plan_reviewed: 'Төлөвлөгөө хянасан',
      visit_started: 'Уулзалт эхлүүлсэн',
      visit_completed: 'Уулзалт дуусгасан',
      visit_draft_saved: 'Ноорог хадгалсан',
      exception_requested: 'Чөлөөлөх хүсэлт илгээсэн',
      exception_reviewed: 'Хүсэлт шийдвэрлэсэн',
      addendum_added: 'Залруулга нэмсэн',
      master_data_changed: 'Мастер дата өөрчилсөн',
      user_created: 'Хэрэглэгч үүсгэсэн',
      user_role_changed: 'Эрх өөрчилсөн',
      user_deactivated: 'Хэрэглэгч идэвхгүй болгосон',
      setting_changed: 'Тохиргоо өөрчилсөн',
      data_export: 'Дата экспортолсон',
      audio_accessed: 'Дуу бичлэг үзсэн',
    } as Record<string, string>,
  },

  // ---------------------------------------------------------------------------
  // Unplanned visit (screen 21). Representatives only.
  // ---------------------------------------------------------------------------
  unplanned: {
    title: 'Төлөвлөгөөнд байхгүй уулзалт',
    start: 'Төлөвлөгөөнд байхгүй уулзалт эхлүүлэх',
    intro:
      'Төлөвлөгөөнд байхгүй ч эмчтэй уулзвал үүгээр бүртгэнэ. Байршлын шаардлага төлөвлөгөөт уулзалттай яг адилхан: та эмнэлгийн доторх зөвшөөрөгдөх зайд байх ёстой.',
    kpiNote:
      'Энэ уулзалт KPI-ийн биелэлтэд ОРОХГҮЙ. Тусад нь "төлөвлөгөөнөөс гадуур" гэж тоологдоно.',
    chooseClinic: 'Аль эмнэлэгт байна вэ?',
    searching: 'Ойролцоох эмнэлгийг хайж байна...',
    noClinicsNearby: 'Ойролцоо эмнэлэг олдсонгүй.',
    withinRadius: 'Дотор нь байна',
    tooFar: 'Хол байна',
    reason: 'Яагаад төлөвлөгөөнөөс гадуур уулзаж байна вэ?',
    reasonHint:
      'Богино тайлбар бичнэ үү. Жишээ нь: "Өөр уулзалтын дараа эмч завтай болсон". Менежер тайланг хараад энэ шалтгааныг уншина.',
    reasonPlaceholder: 'Шалтгаан',
    alreadyPlannedWarning:
      'Анхаар: энэ эмнэлэг өнөөдрийн таны төлөвлөгөөнд аль хэдийн байна. Тэр уулзалтаа эхлүүлэх нь зөв — эсрэг тохиолдолд төлөвлөсөн уулзалт "хийгдээгүй" болж үлдэнэ.',
    goToPlanned: 'Өнөөдрийн маршрут руу очих',
    starting: 'Эхлүүлж байна...',
    refresh: 'Байршлыг дахин шалгах',
  },

  // ---------------------------------------------------------------------------
  // Administration (screens 19 and 20). Administrators only.
  // ---------------------------------------------------------------------------
  admin: {
    usersTitle: 'Хэрэглэгчийн удирдлага',
    masterDataTitle: 'Мастер дата',

    // User list
    newUser: '+ Шинэ хэрэглэгч',
    editUser: 'Хэрэглэгчийн мэдээлэл',
    createUser: 'Шинэ хэрэглэгч бүртгэх',
    searchUser: 'Нэр эсвэл и-мэйлээр хайх',
    activeUsers: 'Идэвхтэй',
    inactiveUsers: 'Идэвхгүй',
    neverSignedIn: 'Нэвтрээгүй',
    neverSignedInHint:
      'Энэ хүн хараахан нэвтрээгүй байна. Тэд ажлын и-мэйлээрээ нэвтэрмэгц бүртгэл автоматаар холбогдоно.',
    noUsers: 'Хэрэглэгч олдсонгүй.',

    // User fields
    fullName: 'Овог нэр',
    email: 'Ажлын и-мэйл хаяг',
    emailHint: 'Зөвхөн зөвшөөрөгдсөн байгууллагын домэйн (жишээ нь monos.mn).',
    emailLocked: 'И-мэйл хаягийг өөрчлөх боломжгүй.',
    emailLockedHint:
      'И-мэйл хаяг нь нэвтрэх бүртгэлтэй холбогддог. Өөрчлөх шаардлагатай бол шинэ хэрэглэгч үүсгээд хуучныг идэвхгүй болгоно уу.',
    phone: 'Утас',
    role: 'Эрх',
    manager: 'Менежер',
    noManager: 'Сонгоогүй',
    reportsTo: (name: string) => `Менежер: ${name}`,

    // Actions
    save: 'Хадгалах',
    saving: 'Хадгалж байна...',
    saved: 'Хадгаллаа.',
    changeRole: 'Эрх өөрчлөх',
    deactivate: 'Идэвхгүй болгох',
    activate: 'Идэвхжүүлэх',
    deactivateReason: 'Шалтгаан',
    deactivateReasonHint: 'Жишээ нь: ажлаас гарсан, өөр албан тушаалд шилжсэн.',
    deactivateConfirm:
      'Идэвхгүй болгосон хэрэглэгч нэвтрэх боломжгүй болно. Бүртгэл устахгүй, өмнөх уулзалтууд хэвээр үлдэнэ.',
    confirmYes: 'Тийм, идэвхгүй болгоно',

    // Brand assignments
    brands: 'Хариуцсан брэнд',
    brandsHint: 'Брэндийг зөвхөн эмнэлгийн төлөөлөгчид хуваарилна.',
    addBrand: 'Брэнд нэмэх',
    removeBrand: 'Хасах',
    removeBrandConfirm:
      'Хуваарилалтыг дуусгах уу? Өмнөх уулзалтууд энэ брэндтэй хэвээр холбоотой байна.',
    noBrands: 'Брэнд хуваарилаагүй байна.',
    noBrandsToAdd: 'Нэмэх боломжтой брэнд алга.',

    // Master data
    counts: 'Товч тоо',
    clinics: 'Эмнэлэг',
    doctors: 'Эмч',
    brandsSection: 'Брэнд',
    products: 'Бүтээгдэхүүн',
    archived: 'Архивласан',
    defaultRadiusCount: 'Анхны радиустай хэвээр',
    defaultRadiusHint:
      'Эдгээр эмнэлгийн зөвшөөрөгдөх зайг тохируулаагүй байна. "Ирсэн гэж бүртгүүлэх боломжгүй" гэсэн гомдлын хамгийн түгээмэл шалтгаан нь энэ.',

    newClinic: '+ Шинэ эмнэлэг',
    newDoctor: '+ Шинэ эмч',
    newBrand: '+ Шинэ брэнд',
    newProduct: '+ Шинэ бүтээгдэхүүн',
    editClinic: 'Эмнэлгийн мэдээлэл',
    editDoctor: 'Эмчийн мэдээлэл',

    // Clinic fields
    code: 'Код',
    clinicName: 'Эмнэлгийн нэр',
    clinicType: 'Төрөл',
    district: 'Дүүрэг',
    address: 'Хаяг',
    latitude: 'Өргөрөг (latitude)',
    longitude: 'Уртраг (longitude)',
    coordinatesHint:
      'Google Maps дээр цэг дээр удаан дарж координатыг хуулж авна. Өргөрөг эхэлж, дараа нь уртраг.',
    coordinatesImplausible:
      'Анхаар: энэ координат Монголын нутгаас гадуур байна. Өргөрөг, уртраг хоёрыг сольж бичсэн байж болзошгүй.',
    radius: 'Зөвшөөрөгдөх зай (метр)',
    radiusHint:
      'Төлөөлөгч эмнэлгээс энэ зайд байж уулзалт эхлүүлнэ. Хэвийн клиникт 150 м. Том эмнэлгийн байранд 300-500 м. 30-2000 м-ийн хооронд байна.',
    contactPhone: 'Эмнэлгийн утас',
    notes: 'Тэмдэглэл',

    // Doctor fields
    doctorName: 'Эмчийн нэр',
    speciality: 'Мэргэжил',
    doctorEmail: 'И-мэйл',
    professionalNotes: 'Мэргэжлийн тэмдэглэл',
    professionalNotesHint:
      'Зөвхөн мэргэжлийн мэдээлэл. Өвчтөний талаарх ямар нэг мэдээлэл бичихийг хориглоно.',
    similarDoctors: 'Ижил төстэй эмч аль хэдийн бүртгэлтэй байна:',

    // Brand / product fields
    brandName: 'Брэндийн нэр',
    productName: 'Бүтээгдэхүүний нэр',
    sku: 'SKU',
    category: 'Ангилал',
    brandOf: 'Брэнд',

    isActive: 'Идэвхтэй',
    isActiveHint: 'Идэвхгүй болгосон бичлэг шинэ төлөвлөгөөнд сонгогдохгүй.',
    archive: 'Архивлах',
    archiveHint:
      'Архивласан бичлэг жагсаалтаас алга болно. Өмнөх уулзалтууд хэвээр үлдэнэ. Устгах боломжгүй.',
    archiveConfirm: 'Архивлах уу? Энэ үйлдлийг аппаас буцаах боломжгүй.',
    archiveNeedsInactive: 'Архивлахын өмнө эхлээд идэвхгүй болгоно уу.',

    searchPlaceholder: 'Хайх',
    nothingFound: 'Илэрц олдсонгүй.',

    errorDuplicate: 'Ийм бичлэг аль хэдийн байна.',
    errorInvalidValue: 'Оруулсан утга зөвшөөрөгдөх хязгаараас гадуур байна.',
    errorNameRequired: 'Нэрийг бөглөнө үү.',
    errorBrandRequired: 'Аль брэндийнх болохыг сонгоно уу.',
    errorSpecialityRequired: 'Мэргэжлийг бөглөнө үү.',
    errorDistrictRequired: 'Дүүргийг бөглөнө үү.',
    errorAddressRequired: 'Хаягийг бөглөнө үү.',
    errorCodeRequired: 'Кодыг бөглөнө үү.',
    errorCoordinatesRequired: 'Координатыг тоогоор бөглөнө үү.',
    errorRadiusRange: 'Зөвшөөрөгдөх зай 30-аас 2000 метрийн хооронд байна.',
    adminOnly: 'Энэ хэсгийг зөвхөн администратор нээнэ.',
  },

  // ---------------------------------------------------------------------------
  // Offline and synchronisation (screen 22).
  // ---------------------------------------------------------------------------
  sync: {
    title: 'Синк төлөв',
    synced: 'Синк хийгдсэн',
    pending: 'Хүлээгдэж буй',
    sending: 'Илгээж байна',
    failed: 'Синк амжилтгүй',

    online: 'Интернэттэй',
    offline: 'Интернэт холболт алга',
    offlineBanner: 'Интернэт алга — хадгалсан мэдээллийг харуулж байна',

    allSynced: 'Бүх мэдээлэл илгээгдсэн.',
    allSyncedHint: 'Илгээгдээгүй үлдсэн зүйл алга.',
    queueTitle: 'Илгээгдээгүй бичлэг',
    queueCount: (n: number) => `${n} бичлэг илгээгдээгүй байна`,
    blockedTitle: 'Анхаарал шаардсан',
    blockedHint:
      'Эдгээрийг сервер хүлээж аваагүй. Шалтгааныг уншаад дахин илгээх эсвэл устгана уу.',
    oldestPending: (age: string) => `Хамгийн эртний бичлэг: ${age}`,

    syncNow: 'Одоо илгээх',
    syncing: 'Илгээж байна...',
    retryOne: 'Дахин илгээх',
    discard: 'Устгах',
    discardConfirm:
      'Энэ бичлэгийг устгах уу? Устгасны дараа сэргээх боломжгүй бөгөөд сервер рүү хэзээ ч илгээгдэхгүй.',
    attempts: (n: number) => `${n} удаа оролдсон`,

    // What each queued operation is, in words a representative recognises.
    kinds: {
      visit_draft_save: 'Уулзалтын тайлангийн ноорог',
      visit_doctors: 'Уулзсан эмч',
      visit_brands: 'Ярилцсан брэнд',
      visit_products: 'Ярилцсан бүтээгдэхүүн',
      visit_complete: 'Уулзалтын тайлан илгээх',
      addendum_add: 'Нэмэлт тайлбар',
      exception_request: 'Чөлөөлөх хүсэлт',
    } as Record<string, string>,

    // Cached-data labelling.
    cachedFresh: 'Шинэ мэдээлэл',
    cachedAt: (age: string) => `Хадгалсан мэдээлэл — ${age} шинэчилсэн`,
    cachedOld:
      'Энэ мэдээлэл хуучирсан байна. Интернэттэй болмогц автоматаар шинэчлэгдэнэ.',

    // Written on the check-in screens, where queueing is deliberately absent.
    needsConnection: 'Энэ үйлдэлд интернэт холболт шаардлагатай.',
    needsConnectionWhy:
      'Уулзалт эхлүүлэх, дуусгах хоёрт таны байршил, цагийг сервер өөрөө шалгаж бүртгэдэг. Утасны цаг, байршлыг ганцаар нь баримт болгон авдаггүй тул эдгээрийг офлайн хийх боломжгүй. Тайлан, нэмэлт тайлбар, чөлөөлөх хүсэлтийг офлайн бичиж болно — интернэттэй болмогц автоматаар илгээгдэнэ.',

    // Sign-out guard.
    signOutWithQueue: (n: number) =>
      `Танд илгээгдээгүй ${n} бичлэг байна. Гарвал эдгээр устана. Эхлээд интернэттэй холбогдож илгээнэ үү.`,

    storage: 'Утсанд хадгалсан',
    storageRows: (cache: number, outbox: number) =>
      `${cache} багц мэдээлэл, ${outbox} илгээх бичлэг`,
    clearedCache: 'Хадгалсан мэдээллийг цэвэрлэлээ.',
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
