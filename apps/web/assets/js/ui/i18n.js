/**
 * i18n.js — bilingual (English / العربية) string layer.
 *
 * Contract:
 *  - every user-visible string lives here; tool pages never hard-code prose
 *  - `t('key')` resolves lang → en → the key itself (missing keys stay visible
 *    on purpose so they get fixed rather than silently rendering empty)
 *  - elements carrying `data-i18n="key"` are translated automatically, and
 *    `data-i18n-attr="placeholder:key"` handles attributes
 *  - Arabic switches the document to RTL; CSS is written with logical properties
 *    so nothing else has to care
 */
import { icon } from './icons.js';

const EN = {
  'brand.name': 'ToolSeer',
  'brand.tagline': 'Free PDF tools that run in your browser',

  'nav.home': 'Home',
  'nav.tools': 'All tools',
  'nav.works': 'Our Works',
  'nav.contact': 'Contact',
  'nav.desktop': 'Desktop app',
  'nav.privacy': 'Privacy',
  'nav.terms': 'Terms',

  'rail.title': 'Configuration',
  'rail.subtitle': 'Customize Output',
  'rail.close': 'Close settings',

  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.label': 'Appearance',

  'lang.switch': 'Switch language',
  'lang.other': 'العربية',

  'support.text': 'All processing happens on your device — your files are never uploaded.',
  'support.cta': 'Support development',
  'support.close': 'Dismiss',

  'action.choose': 'Choose files',
  'action.addMore': 'Add more files',
  'action.clearAll': 'Clear all',
  'action.remove': 'Remove',
  'action.moveUp': 'Move earlier',
  'action.moveDown': 'Move later',
  'action.drag': 'Drag to reorder',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.retry': 'Try again',
  'action.reset': 'Reset',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.download': 'Download',
  'action.downloadAll': 'Download all (.zip)',
  'action.apply': 'Apply',
  'action.rotate': 'Rotate',
  'action.delete': 'Delete',
  'action.restore': 'Restore',
  'action.undo': 'Undo',
  'action.selectAll': 'Select all',
  'action.deselectAll': 'Deselect all',

  'drop.title': 'Click or drag files here',
  'drop.titleMulti': 'Click or drag files here',
  'drop.browse': 'browse',
  'drop.or': 'or',
  'drop.active': 'Release to add files',

  'files.added': 'Files added',
  'files.count': 'files',
  'files.selectedCount': 'selected',
  'files.empty': 'No files added yet.',
  'files.emptyPages': 'Pages will appear here once a file is added.',
  'files.hint': 'Drag the corners to change the order.',

  'progress.working': 'Working…',
  'progress.reading': 'Reading files…',
  'progress.writing': 'Building your file…',
  'progress.done': 'Done',
  'progress.page': 'Page',
  'progress.percent': 'complete',

  'result.title': 'Your file is ready',
  'result.titleMulti': 'Your files are ready',
  'result.downloadStarted': 'Download started automatically.',
  'result.before': 'Before',
  'result.after': 'After',
  'result.saved': 'saved',
  'result.grew': 'The result is larger than the original. Try a different compression level.',
  'result.pages': 'pages',
  'result.images': 'images',
  'result.words': 'words',
  'result.characters': 'characters',

  'empty.title': 'Ready when you are',
  'empty.text': 'Add files using the box above to begin.',

  'privacy.note': 'Processed on your device. Nothing is uploaded.',
  'privacy.title': 'Privacy',
  'privacy.body':
    'ToolSeer runs entirely inside your browser. Files you open are read locally, processed locally, and never sent to a server. There is no upload step, no account, and no tracking of your documents.',

  'bigfile.title': 'Very large job?',
  'bigfile.body':
    'Browser tabs hold everything in memory, so a few hundred pages or a thousand images can run out of room. The desktop app does the same work on disk with no memory ceiling.',
  'bigfile.cta': 'Get the desktop app',

  'upgrade.label': 'Upgrade',
  'upgrade.title': 'ToolSeer Pro — coming soon',
  'upgrade.body':
    'Everything on this site is free and stays free. Pro will add batch automation, unlimited OCR languages and a desktop licence — it does not remove anything you use today.',

  'error.title': 'Something went wrong',
  'error.generic': 'The operation could not be completed.',
  'error.noFiles': 'Add at least one file first.',
  'error.minFiles': 'This tool needs at least {n} files.',
  'error.badType': 'That file type is not supported here.',
  'error.tooLarge': 'This file is too large to process in a browser tab. Use the desktop app instead.',
  'error.corrupt': 'This file looks damaged or is not a valid PDF.',
  'error.encrypted': 'This PDF is password-protected. Open Unlock PDF first.',
  'error.needPassword': 'This PDF is encrypted — enter its password to continue.',
  'error.wrongPassword': 'That password did not work.',
  'error.unsupported': 'This PDF uses a feature that is not supported yet.',
  'error.ocrUnavailable': 'OCR language data is not bundled in this build.',
  'error.offline': 'You appear to be offline. This tool works offline once the page has loaded.',
  'error.memory': 'The browser ran out of memory. Try fewer files, or use the desktop app.',
  'error.timeout': 'The operation took too long and was stopped.',
  'error.hint.retry': 'Reload the page and try again.',

  'footer.tagline': 'Free, private PDF tools. No signup, no upload, no limits.',
  'footer.tools': 'Tools',
  'footer.company': 'Company',
  'footer.legal': 'Legal',
  'footer.version': 'Version',
  'footer.disclaimer': 'Disclaimer',
  'footer.disclaimerBody':
    'ToolSeer is provided as-is without warranty. Always keep a copy of your original files. We are not liable for data loss resulting from use of these tools.',
  'footer.builtWith': 'Runs fully in your browser.',

  'tool.image-to-pdf.title': 'Convert Images to PDF',
  'tool.image-to-pdf.action': 'Convert to PDF',
  'tool.merge-pdf.title': 'Merge PDF Files',
  'tool.merge-pdf.action': 'Merge PDFs',
  'tool.compress-pdf.title': 'Compress PDF',
  'tool.compress-pdf.action': 'Compress PDF',
  'tool.split-pdf.title': 'Split PDF',
  'tool.split-pdf.action': 'Split PDF',
  'tool.protect-pdf.title': 'Protect PDF',
  'tool.protect-pdf.action': 'Protect PDF',
  'tool.unlock-pdf.title': 'Unlock PDF',
  'tool.unlock-pdf.action': 'Unlock PDF',
  'tool.pdf-to-images.title': 'PDF to Images',
  'tool.pdf-to-images.action': 'Convert to images',
  'tool.organize-pdf.title': 'Organize PDF Pages',
  'tool.organize-pdf.action': 'Save changes',
  'tool.extract-text-pdf.title': 'Extract Text from PDF',
  'tool.extract-text-pdf.action': 'Extract text',

  'setting.pageSize.label': 'Page size',
  'setting.pageSize.hint': 'Output page dimensions.',
  'setting.orientation.label': 'Orientation',
  'setting.orientation.hint': 'Applies to every generated page.',
  'setting.margins.label': 'Margins',
  'setting.margins.hint': 'Space kept around each image.',
  'setting.quality.label': 'Image quality',
  'setting.quality.hint': 'Lower quality means a smaller file.',
  'setting.sorting.label': 'Sorting',
  'setting.filename.label': 'File name',
  'setting.range.label': 'Pages',
  'setting.mode.label': 'Split mode',
  'setting.everyN.label': 'Pages per file',
  'setting.mergeToOne.label': 'Also produce one combined PDF',
  'setting.level.label': 'Compression level',
  'setting.removeMetadata.label': 'Remove metadata',
  'setting.removeMetadata.hint': 'Strips title, author and software tags.',
  'setting.password.label': 'Password',
  'setting.passwordConfirm.label': 'Confirm password',
  'setting.ownerPassword.label': 'Owner password',
  'setting.ownerPassword.hint': 'Optional. Controls permissions; leave empty to reuse the user password.',
  'setting.permissions.label': 'Permissions',
  'setting.allowPrint': 'Allow printing',
  'setting.allowCopy': 'Allow copying text',
  'setting.allowModify': 'Allow editing',
  'setting.allowAnnotate': 'Allow comments and forms',
  'setting.format.label': 'Image format',
  'setting.dpi.label': 'Resolution',
  'setting.dpi.hint': 'Higher resolution means sharper images and larger files.',
  'setting.ocr.label': 'Use OCR',
  'setting.ocr.hint': 'Reads text from scans. The language data is a large one-time download.',
  'setting.ocrLang.label': 'OCR languages',
  'setting.layout.label': 'Keep layout',
  'setting.layout.hint': 'Preserves spacing and line breaks where the PDF allows it.',

  'opt.a4': 'A4 (Standard)',
  'opt.letter': 'Letter (US)',
  'opt.legal': 'Legal',
  'opt.fit': 'Fit to image',
  'opt.portrait': 'Portrait',
  'opt.landscape': 'Landscape',
  'opt.auto': 'Automatic',
  'opt.none': 'None',
  'opt.small': 'Small',
  'opt.medium': 'Medium',
  'opt.large': 'Large',
  'opt.low': 'Low',
  'opt.high': 'High',
  'opt.original': 'Original order',
  'opt.name': 'File name',
  'opt.size': 'File size',
  'opt.date': 'Date modified',
  'opt.each': 'One file per page',
  'opt.ranges': 'Custom ranges',
  'opt.every-n': 'Every N pages',
  'opt.lossless': 'Lossless (safest)',
  'opt.balanced': 'Balanced (recommended)',
  'opt.strong': 'Strong (smallest)',
  'opt.png': 'PNG (lossless)',
  'opt.jpeg': 'JPEG (smaller)',
  'opt.dpi72': '72 DPI (screen)',
  'opt.dpi150': '150 DPI (good)',
  'opt.dpi300': '300 DPI (print)',
  'opt.eng': 'English',
  'opt.ara': 'Arabic',
  'opt.eng+ara': 'English + Arabic',

  'units.file': 'file',
  'units.files': 'files',
  'units.page': 'page',
  'units.pages': 'pages',
  'units.image': 'image',
  'units.images': 'images',
  'units.selected': 'selected',
  'units.of': 'of',

  /* --- per-tool additions (kept together so parallel agents do not collide) --- */
  'setting.bookmarks.label': 'Add bookmarks',
  'setting.bookmarks.hint': 'Creates one bookmark per source file, named after the file.',
  'setting.level.lossless.hint': 'Rebuilds the file structure with tighter compression. Nothing is re-encoded, so quality is untouched.',
  'setting.level.balanced.hint': 'Downsamples images above 150 DPI and re-encodes them as JPEG. The usual best trade-off.',
  'setting.level.strong.hint': 'Downsamples to about 96 DPI with stronger JPEG compression. Smallest file, visible quality loss.',
  'setting.algorithm.label': 'Encryption',
  'setting.algorithm.hint': 'AES-256 is what modern viewers expect. RC4 is only for very old software.',
  'setting.password.hint': 'Required to open the file. There is no recovery if you lose it.',
  'setting.passwordConfirm.hint': 'Both entries must match.',
  'setting.permissions.hint': 'Viewers honour these flags, but they are not a cryptographic guarantee.',
  'setting.range.hint': 'For example 1-3, 5, 8-12. Page numbers start at 1.',
  'setting.range.placeholder': '1-3, 5, 8-12',
  'setting.mode.hint': 'How the pages are divided into files.',
  'setting.mergeToOne.hint': 'Useful when splitting by ranges and you also want one combined file.',
  'setting.format.hint': 'PNG keeps every pixel; JPEG is much smaller for photo-heavy pages.',
  'setting.filename.hint': 'Used as the base name for the files you download.',
  'setting.sorting.hint': 'Sorting also reorders the pages before the operation runs.',

  'opt.aes-256': 'AES-256 (strongest)',
  'opt.aes-128': 'AES-128',
  'opt.rc4-128': 'RC4-128 (legacy)',
  'opt.each.hint': 'One separate PDF for every page.',
  'opt.ranges.hint': 'You type the page ranges to keep or split.',
  'opt.every-n.hint': 'Fixed number of pages per output file.',

  'action.rotateLeft': 'Rotate left',
  'action.rotateRight': 'Rotate right',
  'action.deletePage': 'Delete page',
  'action.keepPage': 'Keep page',
  'action.rotateAll': 'Rotate all pages',

  'files.hintPages': 'Drag pages to reorder them. Use the buttons on each page to rotate or delete.',
  'files.allPages': 'All pages',

  'result.imagesCreated': 'images created',
  'result.filesCreated': 'files created',
  'result.noText': 'No text layer was found in this file. It is a scan, so enable OCR to read it.',
  'result.locked': 'The file is now password protected.',
  'result.unlocked': 'The password was removed.',

  'error.passwordMismatch': 'The two passwords do not match.',
  'error.passwordEmpty': 'Enter a password first.',
  'error.rangeInvalid': 'That page range could not be read. Use the form 1-3, 5, 8-12.',
  'error.rangeEmpty': 'The range selects no pages.',

  'setting.allowPrint.hint': 'Lets the reader send the file to a printer.',
  'setting.allowCopy.hint': 'Lets the reader select and copy text.',
  'setting.allowModify.hint': 'Lets the reader edit pages and content.',
  'setting.allowAnnotate.hint': 'Lets the reader add comments and fill in form fields.',
  'setting.replaceFile': 'Adding another file replaces the current one.',

  /* --- toolbox hub --- */
  'toolbox.title': 'ToolSeer Toolbox',
  'toolbox.subtitle': 'What do you want to do?',
  'toolbox.searchLabel': 'Search tools',
  'toolbox.searchPlaceholder': 'Search — “compress”, “دمج”, “password”…',
  'toolbox.filter.all': 'All',
  'toolbox.filter.recent': 'Last used',
  'toolbox.filter.favorites': 'Favorites',
  'toolbox.favorite.add': 'Add to favourites',
  'toolbox.favorite.remove': 'Remove from favourites',
  'toolbox.count': '{n} tools',
  'toolbox.empty.search': 'No tool matches “{q}”. Try “merge”, “compress” or “password”.',
  'toolbox.empty.recent': 'Tools you open appear here, most recent first.',
  'toolbox.empty.favorites': 'Star a tool and it stays here for next time.',
  'toolbox.soon': 'Soon',
  'toolbox.soonNote': 'Planned for the next release — not clickable yet.',
  'toolbox.readyNote': 'Works now, entirely in your browser.',

  'toolbox.desc.image-to-pdf': 'Turn photos and scans into one PDF.',
  'toolbox.desc.merge-pdf': 'Combine several PDFs into one document.',
  'toolbox.desc.compress-pdf': 'Make a PDF smaller for email or upload.',
  'toolbox.desc.split-pdf': 'Break a PDF into pages, ranges or chunks.',
  'toolbox.desc.protect-pdf': 'Add a password and set reader permissions.',
  'toolbox.desc.unlock-pdf': 'Remove a password you already know.',
  'toolbox.desc.pdf-to-images': 'Export every page as PNG or JPEG.',
  'toolbox.desc.organize-pdf': 'Reorder, rotate and delete pages visually.',
  'toolbox.desc.extract-text-pdf': 'Pull the text layer out of a PDF.',

  'toolbox.soon.rotate-pdf': 'Rotate PDF',
  'toolbox.soon.watermark-pdf': 'Add watermark',
  'toolbox.soon.page-numbers': 'Add page numbers',
  'toolbox.soon.pdf-to-word': 'PDF to Word',
  'toolbox.soon.sign-pdf': 'Sign PDF',
  'toolbox.soon.compare-pdf': 'Compare PDFs',
  'toolbox.soon.repair-pdf': 'Repair PDF',
  'toolbox.soon.edit-metadata': 'Edit PDF metadata',

  'toolbox.desktop.title': 'Desktop app — Windows integration',
  'toolbox.desktop.body': 'The same tools with no memory ceiling: process a thousand images or a seven-hundred-page file, batch a whole folder, and work fully offline. Files go from your disk, through the native engine, back to your disk.',
  'toolbox.desktop.cta': 'Get the desktop app',
  'toolbox.desktop.ready': 'Native engine ready — qpdf and PDFium loaded.',
  'toolbox.desktop.checking': 'Checking the native engine…',
  'toolbox.desktop.unavailable': 'Running in the browser: the in-page engine is handling your files.',
  'toolbox.desktop.notReady': 'The native engine reported a problem; the in-page engine is still available.',

  'titlebar.home': 'Home',
  'titlebar.back': 'Back',
  'titlebar.forward': 'Forward',
  'titlebar.reload': 'Reload',
  'titlebar.minimize': 'Minimise',
  'titlebar.close': 'Close',

  'warning.compressionIneffective': 'This file did not shrink with the chosen level ({pct}% larger), so the original was kept unchanged.',
  'warning.imageRecompressionUnavailable': 'Image recompression is not available in this build, so the lossless rebuild was used instead.',
  'warning.notEncrypted': 'The file did not appear to be encrypted; it was saved unchanged.',
  'warning.weakEncryption': 'This file used legacy {algo} encryption. It was re-saved with the settings you chose.',
  'warning.ocrFailed': 'OCR failed on page {page}; that page was left empty.',
  'warning.metadataUnavailable': 'The file metadata could not be read; the output carries none.',
  'warning.outlineUnavailable': 'The source had no outline to preserve.',
  'warning.reencoded': '{name} was re-encoded to fit the PDF format, which can reduce its quality.',
  'warning.textLayerLost': 'Pages were rebuilt as images, so text inside the result is no longer selectable.',
  'warning.passwordRemoved': 'The password protection was removed.',

  'pwa.install': 'Install app',
  'pwa.installed': 'ToolSeer is installed on this device.',
  'pwa.howto.title': 'Install ToolSeer on this device',
  'pwa.howto.ios': 'Tap the Share button, then “Add to Home Screen”.',
  'pwa.howto.android': 'Open the browser menu, then “Install app” or “Add to Home screen”.',
  'pwa.howto.desktop': 'Click the install icon in the address bar, then “Install”.',
  'pwa.offlineReady': 'Ready to work offline.',
  'pwa.ios.step1': 'Open the Share menu: tap the Share button in the toolbar (the square with an arrow pointing up).',
  'pwa.ios.step2': 'In the share sheet, scroll down and tap “Add to Home Screen”.',
  'pwa.ios.step3': 'Tap “Add” in the top corner — the ToolSeer icon appears on your home screen.',
  'pwa.ios.step4': 'Open ToolSeer from that icon; it starts full screen, like an app.',
};

/** Extra Arabic entries, merged into AR below so both dictionaries stay in one file. */
const AR_EXTRA = {
  'units.of': 'من',

  'setting.bookmarks.label': 'إضافة علامات مرجعية',
  'setting.bookmarks.hint': 'ينشئ علامة مرجعية لكل ملف باسمه.',
  'setting.level.lossless.hint': 'يعيد بناء بنية الملف بضغط أفضل دون إعادة ترميز، فالجودة لا تتأثر.',
  'setting.level.balanced.hint': 'يخفّض دقة الصور فوق 150 نقطة ويعيد ترميزها JPEG. التوازن المعتاد الأفضل.',
  'setting.level.strong.hint': 'يخفّض الدقة إلى نحو 96 نقطة بضغط JPEG أقوى. أصغر حجم مع فقد واضح في الجودة.',
  'setting.algorithm.label': 'التشفير',
  'setting.algorithm.hint': 'AES-256 هو ما تتوقعه البرامج الحديثة. RC4 للبرامج القديمة جداً فقط.',
  'setting.password.hint': 'مطلوبة لفتح الملف. لا توجد طريقة لاستعادتها إن فقدتها.',
  'setting.passwordConfirm.hint': 'يجب أن يتطابق الإدخالان.',
  'setting.permissions.hint': 'تحترم البرامج هذه الأعلام، لكنها ليست ضماناً تشفيرياً.',
  'setting.range.hint': 'مثال: 1-3, 5, 8-12. ترقيم الصفحات يبدأ من 1.',
  'setting.range.placeholder': '1-3, 5, 8-12',
  'setting.mode.hint': 'كيفية تقسيم الصفحات إلى ملفات.',
  'setting.mergeToOne.hint': 'مفيد عند التقسيم بنطاقات وتريد أيضاً ملفاً واحداً مدمجاً.',
  'setting.format.hint': 'PNG يحفظ كل البكسل، وJPEG أصغر بكثير للصفحات المصوّرة.',
  'setting.filename.hint': 'يُستخدم كاسم أساس للملفات التي تنزّلها.',
  'setting.sorting.hint': 'الترتيب يعيد ترتيب الصفحات أيضاً قبل تنفيذ العملية.',

  'opt.aes-256': 'AES-256 (الأقوى)',
  'opt.aes-128': 'AES-128',
  'opt.rc4-128': 'RC4-128 (قديم)',
  'opt.each.hint': 'ملف PDF مستقل لكل صفحة.',
  'opt.ranges.hint': 'تكتب أنت نطاقات الصفحات.',
  'opt.every-n.hint': 'عدد ثابت من الصفحات لكل ملف.',

  'action.rotateLeft': 'تدوير لليسار',
  'action.rotateRight': 'تدوير لليمين',
  'action.deletePage': 'حذف الصفحة',
  'action.keepPage': 'إبقاء الصفحة',
  'action.rotateAll': 'تدوير كل الصفحات',

  'files.hintPages': 'اسحب الصفحات لإعادة ترتيبها، واستخدم أزرار كل صفحة للتدوير أو الحذف.',
  'files.allPages': 'كل الصفحات',

  'result.imagesCreated': 'صورة تم إنشاؤها',
  'result.filesCreated': 'ملف تم إنشاؤه',
  'result.noText': 'لم يُعثر على طبقة نصية في هذا الملف. إنه صورة ممسوحة، فعّل OCR لقراءته.',
  'result.locked': 'الملف الآن محمي بكلمة مرور.',
  'result.unlocked': 'تمت إزالة كلمة المرور.',

  'error.passwordMismatch': 'كلمتا المرور غير متطابقتين.',
  'error.passwordEmpty': 'أدخل كلمة مرور أولاً.',
  'error.rangeInvalid': 'تعذّرت قراءة نطاق الصفحات. استخدم الصيغة 1-3, 5, 8-12.',
  'error.rangeEmpty': 'النطاق لا يحدد أي صفحة.',

  'setting.allowPrint.hint': 'يسمح للقارئ بإرسال الملف إلى الطابعة.',
  'setting.allowCopy.hint': 'يسمح للقارئ بتحديد النص ونسخه.',
  'setting.allowModify.hint': 'يسمح للقارئ بتعديل الصفحات والمحتوى.',
  'setting.allowAnnotate.hint': 'يسمح للقارئ بإضافة التعليقات وتعبئة النماذج.',
  'setting.replaceFile': 'إضافة ملف آخر ستستبدل الملف الحالي.',

  'warning.compressionIneffective': 'لم يصغر الملف بالمستوى المختار (أكبر بنسبة {pct}٪)، لذا أُبقي الأصل دون تغيير.',
  'warning.imageRecompressionUnavailable': 'إعادة ضغط الصور غير متاحة في هذه النسخة، لذا استُخدمت إعادة البناء دون فقد.',
  'warning.notEncrypted': 'لا يبدو الملف مشفراً؛ حُفظ دون تغيير.',
  'warning.weakEncryption': 'كان الملف يستخدم تشفير {algo} القديم. أُعيد حفظه بالإعدادات التي اخترتها.',
  'warning.ocrFailed': 'فشل OCR في الصفحة {page}؛ تُركت هذه الصفحة فارغة.',
  'warning.metadataUnavailable': 'تعذّرت قراءة بيانات الملف الوصفية؛ الناتج لا يحمل أي بيانات.',
  'warning.outlineUnavailable': 'لا يحتوي الملف الأصلي على فهرس لحفظه.',
  'warning.reencoded': 'أُعيد ترميز {name} ليتوافق مع صيغة PDF، مما قد يقلل جودته.',
  'warning.textLayerLost': 'أُعيد بناء الصفحات كصور، لذا لن يكون النص داخل الناتج قابلاً للتحديد.',
  'warning.passwordRemoved': 'أُزيلت حماية كلمة المرور.',

  /* --- toolbox hub --- */
  'toolbox.title': 'صندوق أدوات تول سير',
  'toolbox.subtitle': 'ماذا تريد أن تفعل؟',
  'toolbox.searchLabel': 'ابحث في الأدوات',
  'toolbox.searchPlaceholder': 'ابحث — «ضغط»، «دمج»، «كلمة مرور»…',
  'toolbox.filter.all': 'الكل',
  'toolbox.filter.recent': 'الأخيرة',
  'toolbox.filter.favorites': 'المفضّلة',
  'toolbox.favorite.add': 'أضف إلى المفضّلة',
  'toolbox.favorite.remove': 'أزل من المفضّلة',
  'toolbox.count': '{n} أداة',
  'toolbox.empty.search': 'لا توجد أداة تطابق «{q}». جرّب «دمج» أو «ضغط» أو «كلمة مرور».',
  'toolbox.empty.recent': 'الأدوات التي تفتحها تظهر هنا، الأحدث أولاً.',
  'toolbox.empty.favorites': 'أضف نجمة إلى أداة لتبقى هنا في المرة القادمة.',
  'toolbox.soon': 'قريباً',
  'toolbox.soonNote': 'مخطّطة للإصدار القادم — غير قابلة للنقر بعد.',
  'toolbox.readyNote': 'تعمل الآن بالكامل داخل متصفحك.',

  'toolbox.desc.image-to-pdf': 'حوّل الصور والمستندات الممسوحة إلى ملف PDF واحد.',
  'toolbox.desc.merge-pdf': 'ادمج عدة ملفات PDF في مستند واحد.',
  'toolbox.desc.compress-pdf': 'قلّل حجم الملف لإرساله بالبريد أو رفعه.',
  'toolbox.desc.split-pdf': 'قسّم الملف إلى صفحات أو نطاقات أو أجزاء.',
  'toolbox.desc.protect-pdf': 'أضف كلمة مرور وحدّد صلاحيات القارئ.',
  'toolbox.desc.unlock-pdf': 'أزل كلمة مرور تعرفها مسبقاً.',
  'toolbox.desc.pdf-to-images': 'صدّر كل صفحة كصورة PNG أو JPEG.',
  'toolbox.desc.organize-pdf': 'أعد ترتيب الصفحات ودوّرها واحذفها بصرياً.',
  'toolbox.desc.extract-text-pdf': 'استخرج طبقة النص من ملف PDF.',

  'toolbox.soon.rotate-pdf': 'تدوير PDF',
  'toolbox.soon.watermark-pdf': 'إضافة علامة مائية',
  'toolbox.soon.page-numbers': 'إضافة أرقام الصفحات',
  'toolbox.soon.pdf-to-word': 'تحويل PDF إلى Word',
  'toolbox.soon.sign-pdf': 'توقيع PDF',
  'toolbox.soon.compare-pdf': 'مقارنة ملفات PDF',
  'toolbox.soon.repair-pdf': 'إصلاح PDF',
  'toolbox.soon.edit-metadata': 'تعديل بيانات PDF الوصفية',

  'toolbox.desktop.title': 'تطبيق سطح المكتب — تكامل الويندوز',
  'toolbox.desktop.body': 'نفس الأدوات بلا سقف للذاكرة: عالج ألفاً من الصور أو ملفاً بسبعمئة صفحة، ونفّذ عمليات جماعية على مجلد كامل، واعمل دون اتصال. تنتقل الملفات من قرصك إلى المحرّك الأصلي ثم تعود إلى قرصك.',
  'toolbox.desktop.cta': 'نزّل تطبيق الويندوز',
  'toolbox.desktop.ready': 'المحرّك الأصلي جاهز — تم تحميل qpdf وPDFium.',
  'toolbox.desktop.checking': 'جارٍ التحقق من المحرّك الأصلي…',
  'toolbox.desktop.unavailable': 'تعمل الآن في المتصفح: المحرّك المدمج يتولّى ملفاتك.',
  'toolbox.desktop.notReady': 'أبلغ المحرّك الأصلي عن مشكلة؛ المحرّك المدمج ما زال متاحاً.',

  'titlebar.home': 'الرئيسية',
  'titlebar.back': 'رجوع',
  'titlebar.forward': 'تقدّم',
  'titlebar.reload': 'تحديث',
  'titlebar.minimize': 'تصغير',
  'titlebar.close': 'إغلاق',

  'pwa.install': 'تثبيت التطبيق',
  'pwa.installed': 'تم تثبيت تول سير على هذا الجهاز.',
  'pwa.howto.title': 'ثبّت تول سير على هذا الجهاز',
  'pwa.howto.ios': 'اضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية».',
  'pwa.howto.android': 'افتح قائمة المتصفح، ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».',
  'pwa.howto.desktop': 'اضغط أيقونة التثبيت في شريط العنوان، ثم «تثبيت».',
  'pwa.offlineReady': 'جاهز للعمل دون اتصال.',
  'pwa.ios.step1': 'افتح قائمة المشاركة: اضغط زر المشاركة في الشريط (المربّع مع سهم للأعلى).',
  'pwa.ios.step2': 'مرّر للأسفل في قائمة المشاركة واضغط «إضافة إلى الشاشة الرئيسية».',
  'pwa.ios.step3': 'اضغط «إضافة» في الأعلى — تظهر أيقونة تول سير على شاشتك الرئيسية.',
  'pwa.ios.step4': 'افتح تول سير من تلك الأيقونة؛ سيعمل بملء الشاشة كتطبيق.',
};

const AR = {
  ...AR_EXTRA,
  'brand.name': 'تول سير',
  'brand.tagline': 'أدوات PDF مجانية تعمل داخل متصفحك',

  'nav.home': 'الرئيسية',
  'nav.tools': 'كل الأدوات',
  'nav.works': 'أعمالنا',
  'nav.contact': 'اتصل بنا',
  'nav.desktop': 'تطبيق الويندوز',
  'nav.privacy': 'الخصوصية',
  'nav.terms': 'الشروط',

  'rail.title': 'الإعدادات',
  'rail.subtitle': 'خصّص المخرجات',
  'rail.close': 'إغلاق الإعدادات',

  'theme.light': 'مضيء',
  'theme.dark': 'مظلم',
  'theme.label': 'المظهر',

  'lang.switch': 'تغيير اللغة',
  'lang.other': 'English',

  'support.text': 'كل المعالجة تتم على جهازك — ملفاتك لا تُرفع إلى أي خادم.',
  'support.cta': 'ادعم التطوير',
  'support.close': 'إغلاق',

  'action.choose': 'اختر الملفات',
  'action.addMore': 'إضافة ملفات',
  'action.clearAll': 'حذف الكل',
  'action.remove': 'إزالة',
  'action.moveUp': 'تقديم',
  'action.moveDown': 'تأخير',
  'action.drag': 'اسحب لإعادة الترتيب',
  'action.cancel': 'إلغاء',
  'action.close': 'إغلاق',
  'action.retry': 'إعادة المحاولة',
  'action.reset': 'إعادة تعيين',
  'action.copy': 'نسخ',
  'action.copied': 'تم النسخ',
  'action.download': 'تنزيل',
  'action.downloadAll': 'تنزيل الكل (.zip)',
  'action.apply': 'تطبيق',
  'action.rotate': 'تدوير',
  'action.delete': 'حذف',
  'action.restore': 'استرجاع',
  'action.undo': 'تراجع',
  'action.selectAll': 'تحديد الكل',
  'action.deselectAll': 'إلغاء التحديد',

  'drop.title': 'اضغط أو اسحب الملفات هنا',
  'drop.titleMulti': 'اضغط أو اسحب الملفات هنا',
  'drop.browse': 'تصفّح',
  'drop.or': 'أو',
  'drop.active': 'أفلت الملفات لإضافتها',

  'files.added': 'الملفات المضافة',
  'files.count': 'ملف',
  'files.selectedCount': 'محدد',
  'files.empty': 'لم تُضف أي ملفات بعد.',
  'files.emptyPages': 'ستظهر الصفحات هنا بعد إضافة ملف.',
  'files.hint': 'اسحب الملف لإعادة ترتيبه.',

  'progress.working': 'جارٍ العمل…',
  'progress.reading': 'جارٍ قراءة الملفات…',
  'progress.writing': 'جارٍ إنشاء الملف…',
  'progress.done': 'تم',
  'progress.page': 'صفحة',
  'progress.percent': 'مكتمل',

  'result.title': 'ملفك جاهز',
  'result.titleMulti': 'ملفاتك جاهزة',
  'result.downloadStarted': 'بدأ التنزيل تلقائياً.',
  'result.before': 'قبل',
  'result.after': 'بعد',
  'result.saved': 'تم توفير',
  'result.grew': 'الناتج أكبر من الأصل. جرّب مستوى ضغط مختلفاً.',
  'result.pages': 'صفحة',
  'result.images': 'صورة',
  'result.words': 'كلمة',
  'result.characters': 'حرف',

  'empty.title': 'جاهز متى شئت',
  'empty.text': 'أضف ملفاتك من الصندوق أعلاه للبدء.',

  'privacy.note': 'تُعالج على جهازك. لا يُرفع أي شيء.',
  'privacy.title': 'الخصوصية',
  'privacy.body':
    'يعمل ToolSeer بالكامل داخل متصفحك. الملفات التي تفتحها تُقرأ محلياً وتُعالج محلياً ولا تُرسل إلى أي خادم. لا توجد خطوة رفع، ولا حساب، ولا تتبّع لمستنداتك.',

  'bigfile.title': 'لديك مهمة ضخمة؟',
  'bigfile.body':
    'تبويب المتصفح يحتفظ بكل شيء في الذاكرة، لذا قد تنفد الذاكرة مع مئات الصفحات أو ألف صورة. تطبيق سطح المكتب ينفّذ نفس العمل على القرص بلا سقف للذاكرة.',
  'bigfile.cta': 'نزّل تطبيق الويندوز',

  'upgrade.label': 'ترقية',
  'upgrade.title': 'ToolSeer Pro — قريباً',
  'upgrade.body':
    'كل ما في هذا الموقع مجاني وسيبقى مجانياً. ستضيف النسخة الاحترافية المعالجة الجماعية، ولغات OCR غير محدودة، وترخيص تطبيق سطح المكتب — دون إزالة أي شيء تستخدمه اليوم.',

  'error.title': 'حدث خطأ ما',
  'error.generic': 'لم تكتمل العملية.',
  'error.noFiles': 'أضف ملفاً واحداً على الأقل أولاً.',
  'error.minFiles': 'تحتاج هذه الأداة إلى {n} ملفات على الأقل.',
  'error.badType': 'نوع هذا الملف غير مدعوم هنا.',
  'error.tooLarge': 'هذا الملف كبير جداً على تبويب المتصفح. استخدم تطبيق سطح المكتب.',
  'error.corrupt': 'يبدو هذا الملف تالفاً أو ليس ملف PDF صالحاً.',
  'error.encrypted': 'هذا الملف محمي بكلمة مرور. استخدم أداة فك الحماية أولاً.',
  'error.needPassword': 'هذا الملف مشفّر — أدخل كلمة المرور للمتابعة.',
  'error.wrongPassword': 'كلمة المرور غير صحيحة.',
  'error.unsupported': 'يستخدم هذا الملف ميزة غير مدعومة بعد.',
  'error.ocrUnavailable': 'بيانات لغة OCR غير مضمنة في هذه النسخة.',
  'error.offline': 'يبدو أنك غير متصل. تعمل هذه الأداة دون اتصال بعد تحميل الصفحة.',
  'error.memory': 'نفدت ذاكرة المتصفح. جرّب ملفات أقل، أو استخدم تطبيق سطح المكتب.',
  'error.timeout': 'استغرقت العملية وقتاً طويلاً وتم إيقافها.',
  'error.hint.retry': 'أعد تحميل الصفحة وحاول مرة أخرى.',

  'footer.tagline': 'أدوات PDF مجانية وخاصة. بلا تسجيل، بلا رفع، بلا حدود.',
  'footer.tools': 'الأدوات',
  'footer.company': 'الموقع',
  'footer.legal': 'قانوني',
  'footer.version': 'الإصدار',
  'footer.disclaimer': 'إخلاء المسؤولية',
  'footer.disclaimerBody':
    'يُقدَّم ToolSeer كما هو دون أي ضمان. احتفظ دائماً بنسخة من ملفاتك الأصلية. لا نتحمل مسؤولية فقدان البيانات الناتج عن استخدام هذه الأدوات.',
  'footer.builtWith': 'يعمل بالكامل داخل متصفحك.',

  'tool.image-to-pdf.title': 'تحويل الصور إلى PDF',
  'tool.image-to-pdf.action': 'تحويل إلى PDF',
  'tool.merge-pdf.title': 'دمج ملفات PDF',
  'tool.merge-pdf.action': 'دمج الملفات',
  'tool.compress-pdf.title': 'ضغط ملفات PDF',
  'tool.compress-pdf.action': 'اضغط الملف',
  'tool.split-pdf.title': 'تقسيم PDF',
  'tool.split-pdf.action': 'قسّم الملف',
  'tool.protect-pdf.title': 'حماية PDF بكلمة مرور',
  'tool.protect-pdf.action': 'احمِ الملف',
  'tool.unlock-pdf.title': 'فك حماية PDF',
  'tool.unlock-pdf.action': 'أزل الحماية',
  'tool.pdf-to-images.title': 'تحويل PDF إلى صور',
  'tool.pdf-to-images.action': 'حوّل إلى صور',
  'tool.organize-pdf.title': 'ترتيب صفحات PDF',
  'tool.organize-pdf.action': 'حفظ التغييرات',
  'tool.extract-text-pdf.title': 'استخراج النص من PDF',
  'tool.extract-text-pdf.action': 'استخرج النص',

  'setting.pageSize.label': 'حجم الصفحة',
  'setting.pageSize.hint': 'أبعاد الصفحات الناتجة.',
  'setting.orientation.label': 'الاتجاه',
  'setting.orientation.hint': 'يُطبَّق على كل الصفحات الناتجة.',
  'setting.margins.label': 'الهوامش',
  'setting.margins.hint': 'المسافة حول كل صورة.',
  'setting.quality.label': 'جودة الصورة',
  'setting.quality.hint': 'الجودة الأقل تعني ملفاً أصغر.',
  'setting.sorting.label': 'الترتيب',
  'setting.filename.label': 'اسم الملف',
  'setting.range.label': 'الصفحات',
  'setting.mode.label': 'طريقة التقسيم',
  'setting.everyN.label': 'عدد الصفحات لكل ملف',
  'setting.mergeToOne.label': 'أنشئ أيضاً ملفاً واحداً مدمجاً',
  'setting.level.label': 'مستوى الضغط',
  'setting.removeMetadata.label': 'إزالة البيانات الوصفية',
  'setting.removeMetadata.hint': 'يحذف العنوان والمؤلف ووسم البرنامج.',
  'setting.password.label': 'كلمة المرور',
  'setting.passwordConfirm.label': 'تأكيد كلمة المرور',
  'setting.ownerPassword.label': 'كلمة مرور المالك',
  'setting.ownerPassword.hint': 'اختيارية. تتحكم بالصلاحيات؛ اتركها فارغة لاستخدام كلمة مرور المستخدم.',
  'setting.permissions.label': 'الصلاحيات',
  'setting.allowPrint': 'السماح بالطباعة',
  'setting.allowCopy': 'السماح بنسخ النص',
  'setting.allowModify': 'السماح بالتعديل',
  'setting.allowAnnotate': 'السماح بالتعليقات والنماذج',
  'setting.format.label': 'صيغة الصورة',
  'setting.dpi.label': 'الدقة',
  'setting.dpi.hint': 'الدقة الأعلى تعني صوراً أوضح وملفات أكبر.',
  'setting.ocr.label': 'استخدام OCR',
  'setting.ocr.hint': 'يقرأ النص من الصور الممسوحة. بيانات اللغة تنزيل كبير لمرة واحدة.',
  'setting.ocrLang.label': 'لغات OCR',
  'setting.layout.label': 'الحفاظ على التنسيق',
  'setting.layout.hint': 'يحافظ على المسافات وفواصل الأسطر قدر ما يسمح الملف.',

  'opt.a4': 'A4 (قياسي)',
  'opt.letter': 'Letter (أمريكي)',
  'opt.legal': 'Legal',
  'opt.fit': 'بحسب الصورة',
  'opt.portrait': 'طولي',
  'opt.landscape': 'عرضي',
  'opt.auto': 'تلقائي',
  'opt.none': 'بلا هوامش',
  'opt.small': 'صغيرة',
  'opt.medium': 'متوسطة',
  'opt.large': 'كبيرة',
  'opt.low': 'منخفضة',
  'opt.high': 'عالية',
  'opt.original': 'الترتيب الأصلي',
  'opt.name': 'اسم الملف',
  'opt.size': 'حجم الملف',
  'opt.date': 'تاريخ التعديل',
  'opt.each': 'ملف لكل صفحة',
  'opt.ranges': 'نطاقات مخصصة',
  'opt.every-n': 'كل N صفحات',
  'opt.lossless': 'بلا فقد (الأكثر أماناً)',
  'opt.balanced': 'متوازن (موصى به)',
  'opt.strong': 'قوي (الأصغر حجماً)',
  'opt.png': 'PNG (بلا فقد)',
  'opt.jpeg': 'JPEG (أصغر)',
  'opt.dpi72': '72 نقطة (شاشة)',
  'opt.dpi150': '150 نقطة (جيد)',
  'opt.dpi300': '300 نقطة (طباعة)',
  'opt.eng': 'الإنجليزية',
  'opt.ara': 'العربية',
  'opt.eng+ara': 'الإنجليزية + العربية',

  'units.file': 'ملف',
  'units.files': 'ملفات',
  'units.page': 'صفحة',
  'units.pages': 'صفحات',
  'units.image': 'صورة',
  'units.images': 'صور',
  'units.selected': 'محدد',
};

const DICTS = { en: EN, ar: AR };
const STORAGE_KEY = 'toolseer:lang';
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

const listeners = new Set();

function detect() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DICTS[stored]) return stored;
  } catch { /* private mode */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')).toLowerCase();
  return nav.startsWith('ar') ? 'ar' : 'en';
}

let current = detect();

/** @param {string} key @param {Record<string,string|number>} [vars] */
export function t(key, vars) {
  const raw = (DICTS[current] && DICTS[current][key]) ?? EN[key] ?? key;
  if (raw === key && typeof console !== 'undefined') {
    console.warn(`[toolseer] missing i18n key: ${key}`);
  }
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

export function getLang() { return current; }
export function isRTL(lang = current) { return RTL.has(lang); }
export function dir(lang = current) { return isRTL(lang) ? 'rtl' : 'ltr'; }

/**
 * Does a key exist in the active language or in English?
 * Used by UI builders that must decide whether to render an optional hint
 * instead of printing a raw key at the user.
 */
export function hasKey(key) {
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(DICTS[current] || {}, key)
      || Object.prototype.hasOwnProperty.call(EN, key);
}

/** Translate a whole document: [data-i18n], [data-i18n-attr], [data-i18n-title]. */
export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.getAttribute('data-i18n-attr').split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

export function setLang(lang, { persist = true } = {}) {
  if (!DICTS[lang] || lang === current) return;
  current = lang;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }
  reflect();
  listeners.forEach((fn) => fn(lang));
}

export function toggleLang() { setLang(current === 'ar' ? 'en' : 'ar'); }

/** Push lang/dir/theme onto <html> and re-translate the document. */
export function reflect() {
  const html = document.documentElement;
  html.lang = current;
  html.dir = dir(current);
  apply(document);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Build the standard language pill button. */
export function langButton({ variant = '' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ts-lang${variant ? ' ' + variant : ''}`;
  btn.setAttribute('aria-label', t('lang.switch'));
  btn.innerHTML = `${icon('globe', { size: 16 })}<span data-i18n="lang.other">${t('lang.other')}</span>`;
  btn.addEventListener('click', () => toggleLang());
  return btn;
}

export const SUPPORTED = Object.keys(DICTS);
export { EN, AR, DICTS };
export default { t, setLang, getLang, apply, reflect, onLangChange, isRTL, dir, langButton, toggleLang, hasKey, SUPPORTED };
