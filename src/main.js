"use strict";
// === DOM И ТИПЫ ===
const canvas = document.getElementById('imgCanvas');
const ctx = canvas.getContext('2d');
const imageInput = document.getElementById('imageInput');
const exImageInput = document.getElementById('exImageInput');
const exImageBtn = document.getElementById('exImageBtn');
const addTextBtn = document.getElementById('addTextBtn');
const selectedTextInput = document.getElementById('selectedTextInput');
const deleteTextBtn = document.getElementById('deleteTextBtn');
const downloadBtn = document.getElementById('downloadBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const fontFamilySelect = document.getElementById('fontFamilySelect');
const fontSizeInput = document.getElementById('fontSizeInput');
const textColorInput = document.getElementById('textColorInput');
const strokeColorInput = document.getElementById('strokeColorInput');
const filterPreset = document.getElementById('filterPreset');
const brightnessInput = document.getElementById('brightnessInput');
const contrastInput = document.getElementById('contrastInput');
const blurInput = document.getElementById('blurInput');
// === СОСТОЯНИЯ ===
let currentImage = null;
let layers = [];
let selectedLayerId = null;
let historyStack = [];
let historyIndex = -1;
let isRestoringHistory = false;
let isDragging = false;
let hasMoved = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isResizing = false;
let isRotating = false;
let activeHandle = null;
let initialTransform = null;
let currentFilter = 'none';
let currentBrightness = 100;
let currentContrast = 100;
let currentBlur = 0;
// === ОТРИСОВКА ===
function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentImage) {
        ctx.save(); // сохраняем чистые настройки
        let filterString = `brightness(${currentBrightness}%) contrast(${currentContrast}%) blur(${currentBlur}px)`;
        if (currentFilter === 'grayscale')
            filterString += ' grayscale(100%)';
        if (currentFilter === 'sepia')
            filterString += ' sepia(100%)';
        if (currentFilter === 'invert')
            filterString += ' invert(100%)';
        ctx.filter = filterString;
        // отрисовка картинки с фильтрами
        ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
        ctx.restore(); // сброс фильтров, чтобы текст был без них
    }
    else {
        // заглушка без картинки
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#888';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Загрузите изображение...', canvas.width / 2, canvas.height / 2);
        return;
    }
    // отрисовка всех слоев по порядку
    layers.forEach(item => {
        if (!item)
            return;
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate((item.rotation || 0) * Math.PI / 180);
        if (item.type === 'text') {
            // дефолтные значения
            const font = item.font || 'Impact';
            const size = item.size || 36;
            const color = item.color || '#ffffff';
            const strokeColor = item.strokeColor || '#000000';
            ctx.font = `bold ${size}px ${font}, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = Math.max(2, Math.round(size / 6)); // толщина пропорциональна размеру шрифта
            ctx.lineJoin = 'round'; // скругление острых стыков обводки (miter limit artifact)
            ctx.strokeText(item.text, 0, 0);
            ctx.fillStyle = color;
            ctx.fillText(item.text, 0, 0);
        }
        else if (item.type === 'image')
            ctx.drawImage(item.img, -item.width / 2, -item.height / 2, item.width, item.height);
        ctx.restore();
        // отрисовка рамки с ручками поверх выбранного слоя
        if (item.id === selectedLayerId)
            drawSelectionBox(item);
    });
}
// === КООРДИНАТЫ МЫШИ НА КАНВАСЕ ===
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    // учитываем css-масштаб
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = 0;
    let clientY = 0;
    // проверка тач-событий (касание одним пальцем)
    if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    }
    else if ('changedTouches' in e && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
        // для мыши
    }
    else if ('clientX' in e) {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}
// === КЛИК ПО СЛОЮ ===
function isCursorOverLayer(mouse, item) {
    if (!item || !mouse)
        return false;
    const dimension = getLayerDimensions(item);
    const dx = mouse.x - item.x;
    const dy = mouse.y - item.y;
    const angle = -(item.rotation || 0) * Math.PI / 180;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    return (localX >= -dimension.width / 2 && localX <= dimension.width / 2 &&
        localY >= -dimension.height / 2 && localY <= dimension.height / 2);
}
// === ЧИСТА ПУСТЫХ СЛОЕВ ===
function cleanupEmptyTexts() {
    layers = layers.filter(l => l.type !== 'text' || l.text.trim() !== '');
}
// удаление пустого текстового слоя при выходе с поля ввода "добавить текст"
selectedTextInput.addEventListener('blur', () => {
    cleanupEmptyTexts();
    // сбрасываем выделение, если текущий выбранный слой был удален как пустой
    if (!layers.some(l => l.id === selectedLayerId))
        selectedLayerId = null;
    updateControls();
    renderCanvas();
});
// === ИСТОРИЯ CTRL Z / Y ===
function saveHistory() {
    if (isRestoringHistory)
        return;
    historyStack = historyStack.slice(0, historyIndex + 1); // отрезаем "повторы", если что-то отменяли
    // сохраняем глубокую копию при помощи spread (здесь: создает новый объект для копии свойств l)
    const snapshot = {
        layers: layers.map(l => ({ ...l })), currentFilter, currentBrightness, currentContrast, currentBlur
    };
    historyStack.push(snapshot);
    historyIndex++;
    updateUndoRedoBtns();
}
function updateUndoRedoBtns() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= historyStack.length - 1;
}
function restoreState(index) {
    if (index < 0 || index >= historyStack.length)
        return;
    isRestoringHistory = true;
    historyIndex = index;
    const snapshot = historyStack[historyIndex];
    layers = snapshot.layers.map(l => ({ ...l }));
    currentFilter = snapshot.currentFilter;
    currentBrightness = snapshot.currentBrightness;
    currentContrast = snapshot.currentContrast;
    currentBlur = snapshot.currentBlur;
    filterPreset.value = currentFilter;
    brightnessInput.value = currentBrightness.toString();
    contrastInput.value = currentContrast.toString();
    blurInput.value = currentBlur.toString();
    if (!layers.some(l => l.id === selectedLayerId)) {
        selectedLayerId = null;
    }
    isRestoringHistory = false;
    updateControls();
    updateUndoRedoBtns();
    renderCanvas();
}
undoBtn.addEventListener('click', () => restoreState(historyIndex - 1));
redoBtn.addEventListener('click', () => restoreState(historyIndex + 1));
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Я' || e.key === 'я') {
            e.preventDefault();
            if (e.shiftKey)
                restoreState(historyIndex + 1);
            else
                restoreState(historyIndex - 1);
        }
        else if (e.key === 'y' || e.key === 'Н' || e.key === 'н') {
            e.preventDefault();
            restoreState(historyIndex + 1);
        }
    }
});
// === ОБНОВЛЕНИЕ СОСТОЯНИЙ ===
function updateControls() {
    const hasImage = Boolean(currentImage);
    const selectedLayer = layers.find(l => l.id === selectedLayerId);
    const isSelectedText = selectedLayer?.type === 'text';
    // доступны только при загруженной картинке
    addTextBtn.disabled = !hasImage;
    filterPreset.disabled = !hasImage;
    brightnessInput.disabled = !hasImage;
    contrastInput.disabled = !hasImage;
    blurInput.disabled = !hasImage;
    downloadBtn.disabled = !hasImage;
    if (exImageBtn) {
        exImageBtn.style.pointerEvents = hasImage ? 'auto' : 'none';
        exImageBtn.style.opacity = hasImage ? '1' : '0.5';
    }
    // редактирование текста невозможно без его выбора
    selectedTextInput.disabled = !hasImage || !isSelectedText;
    fontFamilySelect.disabled = !hasImage || !isSelectedText;
    fontSizeInput.disabled = !hasImage || !isSelectedText;
    textColorInput.disabled = !hasImage || !isSelectedText;
    strokeColorInput.disabled = !hasImage || !isSelectedText;
    // удалить можно только выбранный слой
    deleteTextBtn.disabled = !hasImage || !selectedLayer;
    if (isSelectedText && selectedLayer?.type === 'text') {
        selectedTextInput.value = selectedLayer.text;
        fontFamilySelect.value = selectedLayer.font || 'Impact';
        fontSizeInput.value = (selectedLayer.size || 36).toString();
        textColorInput.value = selectedLayer.color || '#ffffff';
        strokeColorInput.value = selectedLayer.strokeColor || '#000000';
    }
    else
        selectedTextInput.value = '';
}
// === ЗАГРУЗКА ОСНОВНОГО ФОТО ===
imageInput.addEventListener('change', (e) => {
    const target = e.target;
    const file = target.files?.[0];
    if (!file)
        return;
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            currentImage = img;
            // масштабируем холст
            canvas.height = (img.height / img.width) * canvas.width;
            updateControls(); // разблокируем контролеры
            renderCanvas();
            saveHistory();
        };
        img.src = event.target?.result;
    };
    reader.readAsDataURL(file);
});
// загрузка других фото
exImageInput.addEventListener('change', (e) => {
    const target = e.target;
    const file = target.files?.[0];
    if (!file || !currentImage)
        return;
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            // начальный размер
            const defaultWidth = canvas.width / 3;
            const defaultHeight = (img.height / img.width) * defaultWidth;
            const newExImage = {
                id: Date.now(),
                type: 'image',
                img: img,
                x: canvas.width / 2,
                y: canvas.height / 2,
                width: defaultWidth,
                height: defaultHeight,
                rotation: 0
            };
            layers.push(newExImage);
            selectedLayerId = newExImage.id;
            updateControls();
            renderCanvas();
            saveHistory();
        };
        img.src = event.target?.result;
    };
    reader.readAsDataURL(file);
    target.value = ''; // доступ к повторной загрузке этого же фото
});
// === РАБОТА С ТЕКСТОМ ===
addTextBtn.addEventListener('click', () => {
    const newText = {
        id: Date.now(),
        type: 'text',
        text: 'Новый текст',
        x: canvas.width / 2,
        y: canvas.height / 2,
        size: 36,
        font: 'Impact',
        color: '#ffffff',
        strokeColor: '#000000',
        rotation: 0
    };
    layers.push(newText);
    selectedLayerId = newText.id;
    updateControls();
    renderCanvas();
    saveHistory();
});
selectedTextInput.addEventListener('input', (e) => {
    const target = e.target;
    const selectedText = layers.find(l => l.id === selectedLayerId && l.type === 'text');
    if (selectedText) {
        selectedText.text = target.value;
        renderCanvas();
    }
});
fontFamilySelect.addEventListener('change', (e) => {
    const target = e.target;
    const selectedText = layers.find(l => l.id === selectedLayerId && l.type === 'text');
    if (selectedText) {
        selectedText.font = target.value;
        renderCanvas();
        saveHistory();
    }
});
fontSizeInput.addEventListener('input', (e) => {
    const target = e.target;
    const selectedText = layers.find(l => l.id === selectedLayerId && l.type === 'text');
    if (selectedText) {
        selectedText.size = Number(target.value) || 36;
        renderCanvas();
    }
});
textColorInput.addEventListener('input', (e) => {
    const target = e.target;
    const selectedText = layers.find(l => l.id === selectedLayerId && l.type === 'text');
    if (selectedText) {
        selectedText.color = target.value;
        renderCanvas();
    }
});
strokeColorInput.addEventListener('input', (e) => {
    const target = e.target;
    const selectedText = layers.find(l => l.id === selectedLayerId && l.type === 'text');
    if (selectedText) {
        selectedText.strokeColor = target.value;
        renderCanvas();
    }
});
selectedTextInput.addEventListener('change', saveHistory);
fontSizeInput.addEventListener('change', saveHistory);
textColorInput.addEventListener('change', saveHistory);
strokeColorInput.addEventListener('change', saveHistory);
deleteTextBtn.addEventListener('click', () => {
    layers = layers.filter(t => t.id !== selectedLayerId);
    selectedLayerId = null;
    updateControls();
    renderCanvas();
    saveHistory();
});
// === ФИЛЬТРЫ ФОТО ===
filterPreset.addEventListener('change', (e) => {
    const target = e.target;
    currentFilter = target.value;
    renderCanvas();
    saveHistory();
});
brightnessInput.addEventListener('input', (e) => {
    const target = e.target;
    currentBrightness = Number(target.value);
    renderCanvas();
});
contrastInput.addEventListener('input', (e) => {
    const target = e.target;
    currentContrast = Number(target.value);
    renderCanvas();
});
blurInput.addEventListener('input', (e) => {
    const target = e.target;
    currentBlur = Number(target.value);
    renderCanvas();
});
brightnessInput.addEventListener('change', saveHistory);
contrastInput.addEventListener('change', saveHistory);
blurInput.addEventListener('change', saveHistory);
// === ВЫДЕЛЕНИЕ СЛОЕВ ===
function handlePointerStart(e) {
    const mouse = getMousePos(e);
    hasMoved = false;
    // проверка клика по ручке выделенного слоя
    const selectedLayer = layers.find(l => l.id === selectedLayerId);
    if (selectedLayer) {
        const clickedHandle = getClickedHandle(mouse, selectedLayer);
        if (clickedHandle) {
            activeHandle = clickedHandle;
            clickedHandle === 'rot' ? (isRotating = true) : (isResizing = true);
            initialTransform = {
                x: mouse.x,
                y: mouse.y,
                size: selectedLayer.size || 36,
                width: selectedLayer.width || 0,
                height: selectedLayer.height || 0,
                rotation: selectedLayer.rotation || 0,
                layerX: selectedLayer.x,
                layerY: selectedLayer.y
            };
            return;
        }
    }
    // если клик был не по ручке, а по слою
    let found = false;
    // проверка слоев с конца, чтобы верхний выделялся первым
    for (let i = layers.length - 1; i >= 0; i--) {
        if (isCursorOverLayer(mouse, layers[i])) {
            cleanupEmptyTexts(); // очистка пустых тектовых слоев при клике на другой слой
            selectedLayerId = layers[i].id;
            isDragging = true;
            dragOffsetX = mouse.x - layers[i].x;
            dragOffsetY = mouse.y - layers[i].y;
            found = true;
            // выбранный слой в конец массива, чтобы он отрисовывался поверх остальных
            const selectedItem = layers.splice(i, 1)[0];
            layers.push(selectedItem);
            break;
        }
    }
    // клик в пустое место сбрасывает выделение и удаляет пустые текстовые слои
    if (!found) {
        cleanupEmptyTexts();
        selectedLayerId = null;
    }
    updateControls();
    renderCanvas();
}
// === ПОЛОЖЕНИЕ СЛОЯ ===
function handlePointerMove(e) {
    if (!selectedLayerId)
        return;
    const mouse = getMousePos(e);
    const selectedLayer = layers.find(l => l.id === selectedLayerId);
    if (!selectedLayer)
        return;
    // вращение и масштабирование
    if (isResizing || isRotating) {
        hasMoved = true;
        if (isRotating) {
            const rad = Math.atan2(mouse.y - selectedLayer.y, mouse.x - selectedLayer.x);
            let deg = rad * (180 / Math.PI) + 90;
            selectedLayer.rotation = Math.round(deg);
        }
        else if (isResizing && initialTransform) {
            const dist = Math.hypot(mouse.x - selectedLayer.x, mouse.y - selectedLayer.y);
            const initialDist = Math.hypot(initialTransform.x - selectedLayer.x, initialTransform.y - selectedLayer.y);
            const scale = dist / (initialDist || 1);
            if (selectedLayer.type === 'text') {
                selectedLayer.size = Math.max(10, Math.round(initialTransform.size * scale));
                fontSizeInput.value = selectedLayer.size.toString();
            }
            else if (selectedLayer.type === 'image') {
                selectedLayer.width = Math.max(20, initialTransform.width * scale);
                selectedLayer.height = Math.max(20, initialTransform.height * scale);
            }
        }
        renderCanvas();
        return;
    }
    // перетаскивание
    if (isDragging) {
        const newX = mouse.x - dragOffsetX;
        const newY = mouse.y - dragOffsetY;
        if (selectedLayer.x !== newX || selectedLayer.y !== newY) {
            selectedLayer.x = newX;
            selectedLayer.y = newY;
            hasMoved = true;
            renderCanvas();
        }
    }
}
// === ПРЕКРАЩЕНИЕ РАБОТЫ СО СЛОЕМ ===
function handlePointerEnd() {
    if ((isDragging || isResizing || isRotating) && hasMoved)
        saveHistory();
    isDragging = false;
    isResizing = false;
    isRotating = false;
    hasMoved = false;
    activeHandle = null;
}
// === АКТИВАЦИЯ СОБЫТИЙ (МЫШЬ) ===
canvas.addEventListener('mousedown', handlePointerStart);
canvas.addEventListener('mousemove', handlePointerMove);
canvas.addEventListener('mouseup', handlePointerEnd);
// === АКТИВАЦИЯ СОБЫТИЙ (ТАЧ-СКРИН) ===
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1)
        return;
    e.preventDefault();
    handlePointerStart(e);
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
    if (!isDragging || !selectedLayerId)
        return;
    e.preventDefault();
    handlePointerMove(e);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    handlePointerEnd();
}, { passive: false });
// === ПЕРЕТАСКИВАНИЕ ФОТО НА КАНВАС (Drag & Drop) ===
function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/'))
        return;
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            if (!currentImage) {
                // если основного фото нет - устанавливаем его
                currentImage = img;
                canvas.height = (img.height / img.width) * canvas.width;
            }
            else {
                // добавляем файл как дополнительный слой
                const defaultWidth = canvas.width / 3;
                const defaultHeight = (img.height / img.width) * defaultWidth;
                const newExImage = {
                    id: Date.now(),
                    type: 'image',
                    img: img,
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    width: defaultWidth,
                    height: defaultHeight,
                    rotation: 0
                };
                layers.push(newExImage);
                selectedLayerId = newExImage.id;
            }
            updateControls();
            renderCanvas();
            saveHistory();
        };
        img.src = event.target?.result;
    };
    reader.readAsDataURL(file);
}
canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvas.classList.add('drag-over');
});
canvas.addEventListener('dragleave', () => { canvas.classList.remove('drag-over'); });
canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.classList.remove('drag-over');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleImageFile(e.dataTransfer.files[0]);
    }
});
// === ТРАНСФОРМАЦИЯ ===
function getLayerDimensions(item) {
    // исходный размер
    if (item.type === 'text') {
        ctx.font = `bold ${item.size || 36}px ${item.font || 'Impact'}, sans-serif`;
        const metrics = ctx.measureText(item.text);
        return { width: metrics.width + 16, height: item.size + 10 };
    }
    else if (item.type === 'image')
        return { width: item.width, height: item.height };
    return { width: 0, height: 0 };
}
// ручки
function getHandlePositions(item) {
    const dimension = getLayerDimensions(item);
    const w = dimension.width / 2;
    const h = dimension.height / 2;
    const rotationAngle = (item.rotation || 0) * Math.PI / 180;
    const localHandles = {
        nw: { x: -w, y: -h },
        ne: { x: w, y: -h },
        se: { x: w, y: h },
        sw: { x: -w, y: h },
        rot: { x: 0, y: -h - 25 }
    };
    const worldHandles = {};
    for (let key in localHandles) {
        const lh = localHandles[key];
        const rx = lh.x * Math.cos(rotationAngle) - lh.y * Math.sin(rotationAngle);
        const ry = lh.x * Math.sin(rotationAngle) + lh.y * Math.cos(rotationAngle);
        worldHandles[key] = { x: item.x + rx, y: item.y + ry };
    }
    return worldHandles;
}
// отрисовка рамки и ручек
function drawSelectionBox(item) {
    const dimension = getLayerDimensions(item);
    const handles = getHandlePositions(item);
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate((item.rotation || 0) * Math.PI / 180);
    // рамка
    ctx.strokeStyle = '#4cc9f0';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(-dimension.width / 2, -dimension.height / 2, dimension.width, dimension.height);
    // линия к ручке поворота
    ctx.beginPath();
    ctx.moveTo(0, -dimension.height / 2);
    ctx.lineTo(0, -dimension.height / 2 - 25);
    ctx.stroke();
    ctx.restore();
    // отрисовка
    ctx.save();
    for (let key in handles) {
        const h = handles[key];
        ctx.beginPath();
        ctx.arc(h.x, h.y, key === 'rot' ? 7 : 6, 0, Math.PI * 2);
        ctx.fillStyle = key === 'rot' ? '#ff4d4d' : '#4cc9f0';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.restore();
}
// проверка клика по ручке
function getClickedHandle(mouse, item) {
    if (item.id !== selectedLayerId)
        return null;
    const handles = getHandlePositions(item);
    const clickRadius = 12;
    for (let key in handles) {
        const h = handles[key];
        const dist = Math.hypot(mouse.x - h.x, mouse.y - h.y);
        if (dist <= clickRadius)
            return key;
    }
    return null;
}
// === СКАЧИВАНИЕ ФОТО ===
downloadBtn.addEventListener('click', () => {
    if (!currentImage) {
        alert('Сначала загрузите картинку!');
        return;
    }
    // временно снимаем выделение слоя
    const tempSelectedId = selectedLayerId;
    selectedLayerId = null;
    renderCanvas();
    const link = document.createElement('a');
    link.download = 'img.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    // возвращаем выделение после скачивания
    selectedLayerId = tempSelectedId;
    renderCanvas();
});
// === ЗАПУСК ===
updateControls();
renderCanvas();
