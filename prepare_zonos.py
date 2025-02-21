import torch
import torchaudio
import subprocess
from zonos.model import Zonos

# Функция для получения фонетического представления текста через eSpeak
def get_espeak_data(text):
    try:
        # Вызываем eSpeak для получения фонетического представления в формате IPA
        result = subprocess.run(['espeak', '-q', '--ipa', text], capture_output=True, text=True)
        if result.stderr:
            print(f"Ошибка eSpeak: {result.stderr}")
            return None
        return result.stdout.strip()
    except FileNotFoundError:
        print("Ошибка: eSpeak не найден в системе. Установите его с помощью 'sudo apt-get install espeak'.")
        return None

# Шаг 1: Загрузка модели
def load_model():
    print("Загрузка модели Zyphra/Zonos-v0.1-transformer...")
    model = Zonos.from_pretrained("Zyphra/Zonos-v0.1-transformer", device="cpu")
    model.eval()
    torch.save(model.state_dict(), "zonos_transformer.pt")
    print("Модель сохранена как zonos_transformer.pt")
    return model

# Шаг 2: Обёртка для метода generate
class ZonosGenerateWrapper(torch.nn.Module):
    def __init__(self, zonos_model):
        super(ZonosGenerateWrapper, self).__init__()
        self.zonos_model = zonos_model

    def forward(self, prefix_conditioning):
        out_codes = self.zonos_model.generate(
            prefix_conditioning=prefix_conditioning,
            audio_prefix_codes=None,
            max_new_tokens=86 * 30,
            cfg_scale=2.0,
            batch_size=1
        )
        return out_codes

# Шаг 3: Экспорт generate в ONNX
def export_generate_to_onnx(model):
    print("Подготовка данных для экспорта generate...")
    try:
        wav, sr = torchaudio.load("voice_sample.wav")
        dummy_wav = wav[:, :16000]
    except FileNotFoundError:
        print("Ошибка: файл voice_sample.wav не найден. Создаём заглушку.")
        dummy_wav = torch.zeros(1, 16000)
        sr = 16000

    # Получаем спикерский эмбеддинг
    spk_embedding = model.make_speaker_embedding(dummy_wav, sr)

    # Получаем данные от eSpeak для текста
    text = "Привет, мир!"  # Замените на нужный текст
    espeak_data = get_espeak_data(text)
    if espeak_data is None:
        print("Не удалось получить данные от eSpeak. Прерываем выполнение.")
        return

    # Выводим espeak_data для диагностики
    print(f"espeak_data: {espeak_data}")

    # Формируем словарь условий
    # Передаем espeak_data как кортеж (строка, sample_rate), чтобы соответствовать ожидаемому количеству аргументов
    cond_dict = {
        "speaker_embedding": spk_embedding,
        "espeak": (espeak_data, sr)  # Передаем как кортеж из двух элементов
    }

    try:
        prefix_conditioning = model.prepare_conditioning(cond_dict, uncond_dict=None)
    except Exception as e:
        print(f"Ошибка в prepare_conditioning: {str(e)}")
        return

    # Создание обёртки и трассировка
    wrapper = ZonosGenerateWrapper(model)
    try:
        traced_model = torch.jit.trace(
            wrapper,
            (prefix_conditioning,),
            strict=False
        )
    except Exception as e:
        print(f"Ошибка при трассировке модели: {str(e)}")
        return

    # Экспорт в ONNX
    print("Экспорт generate в zonos_generate.onnx...")
    torch.onnx.export(
        traced_model,
        (prefix_conditioning,),
        "zonos_generate.onnx",
        input_names=["prefix_conditioning"],
        output_names=["out_codes"],
        dynamic_axes={
            "prefix_conditioning": {0: "batch", 1: "cond_seq_len"},
            "out_codes": {0: "batch", 2: "seq_len"}
        },
        opset_version=14
    )
    print("Generate экспортирован в zonos_generate.onnx")

# Шаг 4: Экспорт автоэнкодера
def export_autoencoder(model):
    print("Экспорт автоэнкодера в dac_autoencoder.onnx...")
    dummy_codes = torch.randint(0, 1024, (1, 9, 86 * 30))
    traced_decoder = torch.jit.trace(model.autoencoder.decode, dummy_codes)
    torch.onnx.export(
        traced_decoder,
        dummy_codes,
        "dac_autoencoder.onnx",
        input_names=["codes"],
        output_names=["waveform"],
        dynamic_axes={"codes": {0: "batch", 2: "seq_len"}, "waveform": {0: "batch", 1: "length"}},
        opset_version=14
    )
    print("Автоэнкодер экспортирован в dac_autoencoder.onnx")

# Основная функция
def main():
    model = load_model()
    export_generate_to_onnx(model)
    export_autoencoder(model)

if __name__ == "__main__":
    main()