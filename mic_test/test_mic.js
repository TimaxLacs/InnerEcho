const { spawn } = require('child_process');
const fs = require('fs');

// Записываем 5 секунд звука в файл
const arecord = spawn('arecord', [
  '-f', 'S16_LE',
  '-r', '16000',
  '-c', '1',
  '-D', 'plughw:0,7', // Используем plughw для DMIC16kHz
  '-d', '5',
  '-v', // Добавляем подробный вывод
  'test.wav'
]);

console.log('Начинаем запись... Говорите что-нибудь в течение 5 секунд');

arecord.stderr.on('data', (data) => {
  console.error('Ошибка arecord:', data.toString());
});

arecord.on('close', (code) => {
  if (code === 0) {
    console.log('Запись завершена. Проверьте файл test.wav');
    // Воспроизводим записанный файл
    const aplay = spawn('aplay', ['-v', 'test.wav']);
    aplay.stderr.on('data', (data) => {
      console.error('Ошибка aplay:', data.toString());
    });
    aplay.on('close', (playCode) => {
      if (playCode === 0) {
        console.log('Воспроизведение завершено');
      } else {
        console.error('Ошибка воспроизведения');
      }
    });
  } else {
    console.error('Ошибка записи. Код выхода:', code);
  }
}); 