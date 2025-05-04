# Open Interpreter MCP Server

Этот проект представляет собой MCP-сервер на базе Open Interpreter, который позволяет взаимодействовать с Open Interpreter через HTTP API.

## Установка

1. Создайте виртуальное окружение:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или
venv\Scripts\activate     # Windows
```

2. Установите зависимости:
```bash
pip install -r requirements.txt
```

## Запуск сервера

```bash
uvicorn server:app --reload
```

Сервер будет доступен по адресу: http://localhost:8000

## API Endpoints

- `GET /` - Проверка работоспособности сервера
- `GET /chat?message=<текст>` - Отправка сообщения в Open Interpreter
- `GET /history` - Получение истории сообщений
- `POST /reset` - Сброс истории сообщений

## Запуск тестов

```bash
pytest test_server.py
```

## Примеры использования

### Отправка сообщения через curl:
```bash
curl "http://localhost:8000/chat?message=Hello"
```

### Получение истории:
```bash
curl http://localhost:8000/history
```

### Сброс истории:
```bash
curl -X POST http://localhost:8000/reset
``` 