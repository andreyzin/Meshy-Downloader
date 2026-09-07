# Meshy Downloader

[English](#english) • [Français](#français) • [Русский](#русский)

---

# English

A browser extension for Chromium-based browsers that allows you to download and decrypt your generated 3D models from [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com).

## Why this project exists

Meshy allows users to generate 3D models with AI, but downloading generated assets may require a paid subscription.

However, Meshy-generated models are distributed under a CC0 license.
This project was created from the idea that users should still be able to access the 3D assets they generated themselves.

This extension intercepts the encrypted 3D model data directly from the browser, decrypts it locally, and downloads the final model file.

## Features

* Download generated 3D models from Meshy
* Automatically decrypt encrypted model files
* Works directly inside Chromium-based browsers
* Lightweight and easy to use
* Fully client-side processing

## Supported Browsers

* [Google Chrome](https://www.google.com/chrome/?utm_source=chatgpt.com)
* [Microsoft Edge](https://www.microsoft.com/edge?utm_source=chatgpt.com)
* [Brave Browser](https://brave.com/?utm_source=chatgpt.com)
* Other Chromium-compatible browsers

## Installation

### Manual Installation (Developer Mode)

```bash id="9z28p0"
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Open your Chromium browser
2. Go to:

```text id="5y9t4q"
chrome://extensions
```

3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project folder

## Usage

1. Open [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com)
2. Generate a 3D model
3. Open the generated model page
4. Use the extension download button
5. The encrypted model will be retrieved, decrypted, and downloaded automatically

## How it works

The extension:

1. Detects requests containing generated 3D assets
2. Retrieves the encrypted model data
3. Decrypts the file locally
4. Downloads the usable 3D model

No external server is used.

## Disclaimer

This project is intended for educational and interoperability purposes only.

Users are responsible for complying with:

* Meshy's Terms of Service
* applicable copyright laws
* platform usage policies

This project does not bypass authentication or access content belonging to other users.

## Contributing

Pull requests, issues, and suggestions are welcome.

## License

This project is released under the Unlicense. You are free to use, modify, distribute, and reproduce this software without restriction. For more information, see the LICENSE file or visit: https://unlicense.org/

---

# Français

Une extension de navigateur pour les navigateurs basés sur Chromium permettant de télécharger et déchiffrer les modèles 3D générés sur [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com).

## Pourquoi ce projet existe

Meshy permet de générer des modèles 3D avec l’IA, mais le téléchargement des fichiers générés peut nécessiter un abonnement payant.

Cependant, les modèles générés par Meshy sont distribués sous licence CC0.
Je suis donc parti du principe que les utilisateurs devraient pouvoir accéder aux modèles qu’ils ont eux-mêmes générés.

Cette extension récupère le modèle 3D chiffré directement depuis le navigateur, le déchiffre localement puis télécharge le fichier final.

## Fonctionnalités

* Téléchargement des modèles 3D générés sur Meshy
* Déchiffrement automatique des fichiers
* Compatible avec les navigateurs Chromium
* Léger et simple à utiliser
* Fonctionnement 100% local côté client

## Navigateurs compatibles

* [Google Chrome](https://www.google.com/chrome/?utm_source=chatgpt.com)
* [Microsoft Edge](https://www.microsoft.com/edge?utm_source=chatgpt.com)
* [Brave Browser](https://brave.com/?utm_source=chatgpt.com)
* Autres navigateurs compatibles Chromium

## Installation

### Installation manuelle (mode développeur)

```bash id="v4l8ke"
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Ouvrir votre navigateur Chromium
2. Aller sur :

```text id="vpkd6m"
chrome://extensions
```

3. Activer le **Mode développeur**
4. Cliquer sur **Charger l’extension non empaquetée**
5. Sélectionner le dossier du projet

## Utilisation

1. Ouvrir [Meshy.ai](https://www.meshy.ai?utm_source=chatgpt.com)
2. Générer un modèle 3D
3. Ouvrir la page du modèle généré
4. Utiliser le bouton de téléchargement de l’extension
5. Le modèle chiffré sera récupéré, déchiffré puis téléchargé automatiquement

## Fonctionnement

L’extension :

1. Détecte les requêtes contenant les assets 3D
2. Récupère les données chiffrées du modèle
3. Déchiffre le fichier localement
4. Télécharge le modèle 3D utilisable

Aucun serveur externe n’est utilisé.

## Avertissement

Ce projet est fourni à des fins éducatives et d’interopérabilité uniquement.

Les utilisateurs sont responsables du respect :

* des Conditions d’utilisation de Meshy
* des lois applicables
* des règles d’utilisation de la plateforme

Ce projet ne contourne pas l’authentification et ne permet pas d’accéder aux contenus d’autres utilisateurs.

## Contribution

Les pull requests, issues et suggestions sont les bienvenues.

## Licence

Ce projet est distribué sous licence Unlicense. Vous êtes libre d’utiliser, modifier, distribuer et reproduire ce logiciel sans restriction. Pour plus d’informations, consultez le fichier LICENSE ou : https://unlicense.org/

---

# Русский

Расширение для браузеров на Chromium, позволяющее скачивать и расшифровывать сгенерированные вами 3D-модели с [Meshy.ai](https://www.meshy.ai).

## Зачем этот проект

Meshy позволяет генерировать 3D-модели с помощью ИИ, но скачивание готовых файлов может требовать платной подписки.

При этом модели, созданные в Meshy, распространяются под лицензией CC0.
Проект исходит из того, что пользователь должен иметь доступ к моделям, которые сгенерировал сам.

Расширение перехватывает зашифрованные данные модели прямо в браузере, расшифровывает их локально и сохраняет итоговый файл.

## Возможности

* Скачивание сгенерированных в Meshy 3D-моделей
* Автоматическая расшифровка зашифрованных файлов
* Конвертация в STL, OBJ и 3MF прямо в браузере
* Упрощение сетки ползунком (5-100 % треугольников) — для 3D-печати
* Работает прямо в браузерах на Chromium
* Лёгкое и простое в использовании
* Вся обработка происходит на стороне клиента

## Форматы и упрощение

Шестерёнка на плавающей кнопке открывает панель с выбором формата и
ползунком детализации; там же видно, сколько треугольников останется.

| Формат | Что внутри |
|--------|-----------|
| GLB | исходный файл без изменений, плюс перехваченные текстуры |
| STL | бинарный, только геометрия — обычный вход слайсера |
| OBJ | текстовый, только геометрия |
| 3MF | геометрия в миллиметрах, ZIP без сжатия |

Упрощение работает так: вершины, разорванные по UV-швам, склеиваются,
затем рёбра схлопываются по квадратичной ошибке (Garland-Heckbert) до
заданной доли треугольников; схлопывания, выворачивающие нормали,
отклоняются. Расчёт идёт в Web Worker, исходная модель не изменяется.

Ограничения: материалы, UV и текстуры в STL/OBJ/3MF не переносятся —
экспортируется только геометрия. Модель, сжатая Draco или meshopt,
конвертирована не будет: расширение сообщит об этом явно.

Тесты геометрии: `node test/geometry.test.js` (без зависимостей).

## Поддерживаемые браузеры

* [Google Chrome](https://www.google.com/chrome/)
* [Microsoft Edge](https://www.microsoft.com/edge)
* [Brave Browser](https://brave.com/)
* Другие браузеры на Chromium

## Установка

### Вручную (режим разработчика)

```bash
git clone https://github.com/0rmx0/Meshy-Downloader.git
```

1. Откройте браузер на Chromium
2. Перейдите по адресу:

```text
chrome://extensions
```

3. Включите **Режим разработчика**
4. Нажмите **Загрузить распакованное расширение**
5. Выберите папку проекта

## Использование

1. Откройте [Meshy.ai](https://www.meshy.ai)
2. Сгенерируйте 3D-модель
3. Откройте страницу готовой модели
4. Нажмите кнопку скачивания расширения
5. Зашифрованная модель будет получена, расшифрована и скачана автоматически

## Как это работает

Расширение:

1. Отслеживает запросы с 3D-ресурсами
2. Получает зашифрованные данные модели
3. Расшифровывает файл локально
4. Скачивает готовую 3D-модель

Внешние серверы не используются.

## Диагностика

Если модель не перехватывается, откройте консоль браузера (F12) и посмотрите строки `[Meshy DL]`:

* `👷 новый Worker:` — реальное имя воркера расшифровки
* `[dbg] asset ...` — запросы к `assets.meshy.ai`
* `[dbg] message ...` — структура нераспознанных сообщений воркера

Подробное логирование включается флагом `DEBUG` в начале `content.js`.

## Отказ от ответственности

Проект предназначен исключительно для образовательных целей и обеспечения совместимости.

Пользователи сами отвечают за соблюдение:

* условий использования Meshy
* применимого законодательства об авторском праве
* правил использования платформы

Проект не обходит аутентификацию и не даёт доступа к контенту других пользователей.

## Участие в разработке

Пул-реквесты, issues и предложения приветствуются.

## Лицензия

Проект распространяется под лицензией Unlicense. Вы можете свободно использовать, изменять, распространять и воспроизводить это ПО без ограничений. Подробнее — в файле LICENSE или на https://unlicense.org/

---

Created by [0rmx0](https://github.com/0rmx0?utm_source=chatgpt.com)
