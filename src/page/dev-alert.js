(function ultimateMoocsRunDevAlert() {
  var script = document.currentScript;
  var message =
    script && script.dataset && script.dataset.message
      ? script.dataset.message
      : 'すべての回答を保存しました。\nAll your answers have been saved.';

  window.alert('MOOCs Ultimate 開発用テスト\n\n' + message);
})();
