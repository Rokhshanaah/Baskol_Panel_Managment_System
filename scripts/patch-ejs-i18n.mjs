import fs from 'node:fs';

const files = {
  'views/pages/containers.ejs': [
    ['موقعیت فعلی', "<%= t('fields.currentLocation') %>"],
    ['تاریخ حرکت', "<%= t('fields.departureDate') %>"],
    ['تاریخ رسیدن', "<%= t('fields.arrivalDate') %>"],
    ['کرایه (دالر)', "<%= t('fields.freightUsd') %>"],
    ['/متر مکعب', "<%= t('fields.perCbm') %>"],
    ['>بارگیری<', "><%= t('fields.loadingSection') %><"],
    ['کانتینر و ردیف\u200cهای بارگیری آن حذف شود؟', "<%= t('fields.confirmDeleteContainer') %>"],
    ['وزن (کیلو)', "<%= t('forms.loading.loadWeight') %>"],
    ['اضافه کردن', "<%= t('fields.addItem') %>"],
    ['این جنس از کانتینر حذف شود؟', "<%= t('fields.confirmRemoveCargoFromContainer') %>"],
  ],
  'views/pages/container-loading.ejs': [
    ['>بارگیری<', "><%= t('fields.loadingSection') %><"],
    ['وزن (کیلو)', "<%= t('forms.loading.loadWeight') %>"],
    ['اضافه کردن', "<%= t('fields.addItem') %>"],
    ['این جنس از کانتینر حذف شود؟', "<%= t('fields.confirmRemoveCargoFromContainer') %>"],
  ],
  'views/pages/weighbridge-tickets.ejs': [
    ['>بارگیری<', "><%= fa('loading') %><"],
    ['>تخلیه<', "><%= fa('unloading') %><"],
  ],
};

for (const [file, pairs] of Object.entries(files)) {
  let content = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(file, content);
  console.log('fixed', file);
}
