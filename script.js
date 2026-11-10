"use strict";

/* =========================================================
   SCICALC PRO — APPLICATION ENGINE
   Connected to index.html and css/style.css
   No external libraries or paid APIs required.
   ========================================================= */

/* =========================================================
   1. DOM HELPERS AND APPLICATION STATE
   ========================================================= */

const $ = (id) => document.getElementById(id);

const state = {
    angleMode: "deg",
    answer: 0,
    memory: 0,
    hasMemory: false,
    secondMode: false,
    completed: false,
    expression: "",
    history: [],
    formulaCategory: "all",
    graphFunction: null
};

function safeStorageGet(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
    } catch {
        return fallback;
    }
}

function safeStorageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        showToast("Could not save data in browser storage.", "error");
    }
}

function showToast(message, type = "success") {
    const container = $("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 2800);
}

function formatNumber(value) {
    if (!Number.isFinite(value)) return "Undefined";
    if (Object.is(value, -0)) return "0";

    const rounded = Number(value.toPrecision(12));

    if (Math.abs(rounded) >= 1e12 || (Math.abs(rounded) < 1e-8 && rounded !== 0)) {
        return rounded.toExponential(8).replace(/\.?0+e/, "e");
    }

    return String(rounded);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

/* =========================================================
   2. SCIENTIFIC MATHEMATICAL ENGINE
   Custom parser. No eval() or external dependency.
   ========================================================= */

const FUNCTION_NAMES = [
    "asin", "acos", "atan",
    "sinh", "cosh", "tanh",
    "asinh", "acosh", "atanh",
    "sqrt", "cbrt", "log", "ln",
    "exp", "abs", "sin", "cos", "tan",
    "sec", "csc", "cot", "floor", "ceil",
    "round", "sign", "fact"
];

function factorial(value) {
    if (!Number.isInteger(value) || value < 0 || value > 170) {
        throw new Error("Factorial requires an integer from 0 to 170.");
    }

    let result = 1;

    for (let i = 2; i <= value; i++) {
        result *= i;
    }

    return result;
}

function getMathFunctions(mode) {
    const isDegree = mode === "deg";

    const toRadians = (x) => isDegree ? x * Math.PI / 180 : x;
    const fromRadians = (x) => isDegree ? x * 180 / Math.PI : x;

    const checked = (value) => {
        if (Number.isNaN(value)) {
            throw new Error("Input is outside the function's domain.");
        }
        return value;
    };

    return {
        sin: x => Math.sin(toRadians(x)),
        cos: x => Math.cos(toRadians(x)),
        tan: x => {
            const r = toRadians(x);
            if (Math.abs(Math.cos(r)) < 1e-14) {
                throw new Error("Tangent is undefined at this angle.");
            }
            return Math.tan(r);
        },

        asin: x => checked(fromRadians(Math.asin(x))),
        acos: x => checked(fromRadians(Math.acos(x))),
        atan: x => fromRadians(Math.atan(x)),

        sec: x => {
            const c = Math.cos(toRadians(x));
            if (Math.abs(c) < 1e-14) throw new Error("Secant is undefined.");
            return 1 / c;
        },
        csc: x => {
            const s = Math.sin(toRadians(x));
            if (Math.abs(s) < 1e-14) throw new Error("Cosecant is undefined.");
            return 1 / s;
        },
        cot: x => {
            const t = Math.tan(toRadians(x));
            if (Math.abs(t) < 1e-14) throw new Error("Cotangent is undefined.");
            return 1 / t;
        },

        sinh: Math.sinh,
        cosh: Math.cosh,
        tanh: Math.tanh,
        asinh: Math.asinh,
        acosh: x => checked(Math.acosh(x)),
        atanh: x => checked(Math.atanh(x)),

        sqrt: x => {
            if (x < 0) throw new Error("Square root of a negative number is not real.");
            return Math.sqrt(x);
        },
        cbrt: Math.cbrt,

        log: x => {
            if (x <= 0) throw new Error("Logarithm requires a positive number.");
            return Math.log10(x);
        },
        ln: x => {
            if (x <= 0) throw new Error("Natural logarithm requires a positive number.");
            return Math.log(x);
        },

        exp: Math.exp,
        abs: Math.abs,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        sign: Math.sign,
        fact: factorial
    };
}

function tokenize(source) {
    let text = String(source)
        .replace(/×/g, "*")
        .replace(/÷/g, "/")
        .replace(/[−–]/g, "-")
        .replace(/π/g, "pi")
        .replace(/√/g, "sqrt")
        .replace(/²/g, "^2")
        .replace(/³/g, "^3")
        .replace(/\s+/g, "");

    const tokens = [];
    let i = 0;

    while (i < text.length) {
        const remaining = text.slice(i);
        const char = text[i];

        if (/[0-9.]/.test(char)) {
            const match = remaining.match(
                /^(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?/i
            );

            if (!match) throw new Error("Invalid number.");

            const number = Number(match[0]);

            if (!Number.isFinite(number)) {
                throw new Error("Number is too large.");
            }

            tokens.push({ type: "number", value: number });
            i += match[0].length;
            continue;
        }

        if (/[a-z]/i.test(char)) {
            const match = remaining.match(/^[a-z]+/i)[0].toLowerCase();

            tokens.push({ type: "identifier", value: match });
            i += match.length;
            continue;
        }

        if ("+-*/^%!(),".includes(char)) {
            tokens.push({ type: "operator", value: char });
            i++;
            continue;
        }

        throw new Error(`Unsupported character: ${char}`);
    }

    // Insert multiplication where it is implied:
    // 2pi, 2(3+4), (2)(3), 2sin(30)
    const expanded = [];

    for (let j = 0; j < tokens.length; j++) {
        const current = tokens[j];
        const previous = expanded[expanded.length - 1];

        if (previous) {
            const previousEndsValue =
                previous.type === "number" ||
                (previous.type === "identifier" &&
                    !FUNCTION_NAMES.includes(previous.value)) ||
                (previous.type === "operator" && previous.value === ")") ||
                (previous.type === "operator" && previous.value === "!") ||
                (previous.type === "operator" && previous.value === "%");

            const currentStartsValue =
                current.type === "number" ||
                current.type === "identifier" ||
                (current.type === "operator" && current.value === "(");

            const isFunctionCall =
                previous.type === "identifier" &&
                FUNCTION_NAMES.includes(previous.value) &&
                current.type === "operator" &&
                current.value === "(";

            if (previousEndsValue && currentStartsValue && !isFunctionCall) {
                expanded.push({ type: "operator", value: "*" });
            }
        }

        expanded.push(current);
    }

    return expanded;
}

function evaluate(source, mode = state.angleMode, variables = {}) {
    if (!String(source).trim()) throw new Error("Enter an expression.");

    const tokens = tokenize(source);
    const functions = getMathFunctions(mode);

    let position = 0;

    const peek = () => tokens[position];

    const isOperator = (value) =>
        peek() && peek().type === "operator" && peek().value === value;

    function parseExpression() {
        let value = parseTerm();

        while (isOperator("+") || isOperator("-")) {
            const operator = tokens[position++].value;
            const right = parseTerm();

            value = operator === "+" ? value + right : value - right;
        }

        return value;
    }

    function parseTerm() {
        let value = parseUnary();

        while (true) {
            if (isOperator("*") || isOperator("/")) {
                const operator = tokens[position++].value;
                const right = parseUnary();

                if (operator === "/" && right === 0) {
                    throw new Error("Cannot divide by zero.");
                }

                value = operator === "*" ? value * right : value / right;
            } else {
                break;
            }
        }

        return value;
    }

    function parseUnary() {
        if (isOperator("-")) {
            position++;
            return -parseUnary();
        }

        if (isOperator("+")) {
            position++;
            return parseUnary();
        }

        return parsePower();
    }

    function parsePower() {
        const base = parsePostfix();

        if (isOperator("^")) {
            position++;
            const exponent = parseUnary();

            if (Math.abs(exponent) > 10000) {
                throw new Error("Exponent is too large.");
            }

            return Math.pow(base, exponent);
        }

        return base;
    }

    function parsePostfix() {
        let value = parsePrimary();

        while (isOperator("!") || isOperator("%")) {
            const operator = tokens[position++].value;
            value = operator === "!" ? factorial(value) : value / 100;
        }

        return value;
    }

    function parsePrimary() {
        const token = tokens[position++];

        if (!token) throw new Error("Incomplete expression.");

        if (token.type === "number") {
            return token.value;
        }

        if (token.type === "identifier") {
            const name = token.value;

            if (name === "pi") return Math.PI;
            if (name === "e") return Math.E;

            if (Object.prototype.hasOwnProperty.call(variables, name)) {
                return variables[name];
            }

            if (FUNCTION_NAMES.includes(name)) {
                if (!isOperator("(")) {
                    throw new Error(`Use ${name}(value).`);
                }

                position++;

                const argument = parseExpression();

                if (!isOperator(")")) {
                    throw new Error("Missing closing parenthesis.");
                }

                position++;

                return functions[name](argument);
            }

            throw new Error(`Unknown function or variable: ${name}`);
        }

        if (token.type === "operator" && token.value === "(") {
            const value = parseExpression();

            if (!isOperator(")")) {
                throw new Error("Missing closing parenthesis.");
            }

            position++;
            return value;
        }

        throw new Error("Invalid expression.");
    }

    const result = parseExpression();

    if (position < tokens.length) {
        throw new Error("Unexpected input in expression.");
    }

    if (!Number.isFinite(result)) {
        throw new Error("Result is undefined or outside the supported range.");
    }

    return Number(result.toPrecision(12));
}

/* =========================================================
   3. CALCULATOR KEYPAD
   ========================================================= */

const KEYS = [
    ["2nd", "second", "fn"],
    ["π", "pi", "fn"],
    ["e", "e", "fn"],
    ["AC", "clear", "clear"],
    ["⌫", "back", "clear"],

    ["sin", "sin(", "fn"],
    ["cos", "cos(", "fn"],
    ["tan", "tan(", "fn"],
    ["(", "(", "fn"],
    [")", ")", "fn"],

    ["log", "log(", "fn"],
    ["ln", "ln(", "fn"],
    ["√", "sqrt(", "fn"],
    ["x²", "^2", "fn"],
    ["xʸ", "^", "fn"],

    ["7", "7", ""],
    ["8", "8", ""],
    ["9", "9", ""],
    ["÷", "/", "op"],
    ["n!", "!", "fn"],

    ["4", "4", ""],
    ["5", "5", ""],
    ["6", "6", ""],
    ["×", "*", "op"],
    ["%", "%", "fn"],

    ["1", "1", ""],
    ["2", "2", ""],
    ["3", "3", ""],
    ["−", "-", "op"],
    ["Ans", "ans", "fn"],

    ["0", "0", ""],
    [".", ".", ""],
    ["EXP", "e", "fn"],
    ["+", "+", "op"],
    ["=", "equals", "eq"]
];

const SECOND_KEYS = {
    sin: ["sin⁻¹", "asin("],
    cos: ["cos⁻¹", "acos("],
    tan: ["tan⁻¹", "atan("],
    log: ["10ˣ", "10^"],
    ln: ["eˣ", "exp("],
    "√": ["∛", "cbrt("],
    "x²": ["x³", "^3"]
};

function buildKeypad() {
    const keypad = $("keypad");
    if (!keypad) return;

    keypad.innerHTML = "";

    KEYS.forEach(([label, value, className]) => {
        let displayLabel = label;
        let keyValue = value;

        if (state.secondMode && SECOND_KEYS[label]) {
            [displayLabel, keyValue] = SECOND_KEYS[label];
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = `key ${className}`;
        button.textContent = displayLabel;

        if (label === "2nd" && state.secondMode) {
            button.classList.add("active");
        }

        button.addEventListener("click", () => {
            pressKey(label, keyValue);
        });

        keypad.appendChild(button);
    });
}

function updateCalculatorDisplay() {
    const input = $("expression");
    if (input) input.value = state.expression;

    if ($("memoryIndicator")) {
        $("memoryIndicator").textContent =
            state.hasMemory ? "MEMORY STORED" : "MEMORY EMPTY";
    }
}

function showResult(value, isError = false) {
    const result = $("result");
    if (!result) return;

    result.textContent = value;
    result.classList.toggle("error", isError);
}

function pressKey(label, value) {
    if (value === "second") {
        state.secondMode = !state.secondMode;
        buildKeypad();
        return;
    }

    if (value === "clear") {
        state.expression = "";
        state.completed = false;
        updateCalculatorDisplay();
        showResult("0");
        return;
    }

    if (value === "back") {
        state.expression = state.expression.slice(0, -1);
        state.completed = false;
        updateCalculatorDisplay();
        return;
    }

    if (value === "equals") {
        calculateExpression();
        return;
    }

    if (value === "ans") {
        value = String(state.answer);
    }

    const isOperator = ["+", "-", "*", "/", "^", "%", "!"].includes(value);

    if (state.completed && !isOperator) {
        state.expression = "";
    } else if (state.completed && isOperator) {
        state.expression = String(state.answer);
    }

    state.completed = false;
    state.expression += value;

    updateCalculatorDisplay();
}

function calculateExpression() {
    const source = state.expression.trim();
    if (!source) return;

    try {
        const result = evaluate(source);

        state.answer = result;
        state.expression = "";
        state.completed = true;

        showResult(formatNumber(result));
        updateCalculatorDisplay();

        addHistory(source, result);
    } catch (error) {
        showResult(error.message || "Invalid expression.", true);
    }
}

/* =========================================================
   4. DEG / RAD MODE
   ========================================================= */

function setAngleMode(mode) {
    state.angleMode = mode;

    $("angleToggle").textContent = mode.toUpperCase();

    $("degMode").classList.toggle("active", mode === "deg");
    $("radMode").classList.toggle("active", mode === "rad");

    showToast(`Angle mode: ${mode.toUpperCase()}`);
}

/* =========================================================
   5. MEMORY FUNCTIONS
   ========================================================= */

function memoryOperation(operation) {
    let currentValue;

    try {
        currentValue = state.expression.trim()
            ? evaluate(state.expression)
            : state.answer;
    } catch {
        showToast("Enter a valid calculation first.", "error");
        return;
    }

    switch (operation) {
        case "mc":
            state.memory = 0;
            state.hasMemory = false;
            showToast("Memory cleared.");
            break;

        case "mr":
            if (!state.hasMemory) {
                showToast("Memory is empty.", "error");
                return;
            }
            state.expression += String(state.memory);
            state.completed = false;
            updateCalculatorDisplay();
            break;

        case "mplus":
            state.memory += currentValue;
            state.hasMemory = true;
            showToast("Added to memory.");
            break;

        case "mminus":
            state.memory -= currentValue;
            state.hasMemory = true;
            showToast("Subtracted from memory.");
            break;
    }

    updateCalculatorDisplay();
}

/* =========================================================
   6. CALCULATION HISTORY
   ========================================================= */

function loadHistory() {
    const saved = safeStorageGet("scicalcProHistory", []);

    state.history = Array.isArray(saved)
        ? saved.filter(item =>
            item &&
            typeof item.expression === "string" &&
            Number.isFinite(item.result)
        ).slice(0, 100)
        : [];

    renderHistory();
}

function saveHistory() {
    safeStorageSet("scicalcProHistory", state.history);
}

function addHistory(expression, result) {
    state.history.unshift({
        id: Date.now() + Math.random(),
        expression,
        result,
        date: new Date().toISOString()
    });

    state.history = state.history.slice(0, 100);

    saveHistory();
    renderHistory();
}

function renderHistory() {
    const container = $("historyList");
    if (!container) return;

    const search = ($("historySearch")?.value || "").toLowerCase();

    const filtered = state.history.filter(item =>
        item.expression.toLowerCase().includes(search) ||
        String(item.result).toLowerCase().includes(search)
    );

    container.innerHTML = "";

    if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";

        const icon = document.createElement("span");
        icon.className = "empty-icon";
        icon.textContent = "◷";

        const title = document.createElement("strong");
        title.textContent = state.history.length
            ? "No matching calculations"
            : "No calculations yet";

        const message = document.createElement("p");
        message.textContent = state.history.length
            ? "Try another search."
            : "Your results will appear here.";

        empty.append(icon, title, message);
        container.appendChild(empty);
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement("article");
        card.className = "history-item";

        const expression = document.createElement("div");
        expression.className = "history-expression";
        expression.textContent = item.expression;

        const result = document.createElement("div");
        result.className = "history-result";
        result.textContent = `= ${formatNumber(item.result)}`;

        const actions = document.createElement("div");
        actions.className = "history-actions";

        const reuseButton = document.createElement("button");
        reuseButton.type = "button";
        reuseButton.textContent = "Reuse";
        reuseButton.addEventListener("click", () => {
            state.expression = item.expression;
            state.completed = false;
            updateCalculatorDisplay();
            showToast("Calculation restored.");
            showPage("calculator");
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-history";
        deleteButton.textContent = "Delete";

        deleteButton.addEventListener("click", () => {
            state.history = state.history.filter(entry => entry.id !== item.id);
            saveHistory();
            renderHistory();
            showToast("History entry deleted.");
        });

        actions.append(reuseButton, deleteButton);
        card.append(expression, result, actions);
        container.appendChild(card);
    });
}

function clearHistory() {
    if (!state.history.length) {
        showToast("History is already empty.");
        return;
    }

    if (!confirm("Clear all calculation history?")) return;

    state.history = [];
    saveHistory();
    renderHistory();
    showToast("History cleared.");
}

function exportHistory() {
    if (!state.history.length) {
        showToast("There is no history to export.", "error");
        return;
    }

    const rows = [
        ["Expression", "Result", "Date"],
        ...state.history.map(item => [
            item.expression,
            item.result,
            item.date
        ])
    ];

    const csv = rows.map(row =>
        row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "scicalc-pro-history.csv";
    link.click();

    URL.revokeObjectURL(url);
    showToast("History exported.");
}

/* =========================================================
   7. NAVIGATION
   ========================================================= */

const PAGE_TITLES = {
    calculator: "Scientific Calculator",
    graph: "Graph Plotter",
    equations: "Equation Solver",
    matrices: "Matrix Calculator",
    statistics: "Statistics",
    converter: "Unit Converter",
    formulas: "Formula Library"
};

function showPage(pageName) {
    if (!PAGE_TITLES[pageName]) return;

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
    });

    const target = $(`page-${pageName}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });

    $("pageTitle").textContent = PAGE_TITLES[pageName];

    $("sidebar").classList.remove("open");

    if (pageName === "graph" && state.graphFunction) {
        drawGraph();
    }
}

/* =========================================================
   8. GRAPH PLOTTER
   ========================================================= */

function resizeGraphCanvas() {
    const canvas = $("graphCanvas");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawGraph() {
    const canvas = $("graphCanvas");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    resizeGraphCanvas();

    const ctx = canvas.getContext("2d");
    const width = rect.width;
    const height = rect.height;

    const minX = Number($("graphMin").value);
    const maxX = Number($("graphMax").value);

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX >= maxX) {
        $("graphMessage").textContent = "Enter a valid minimum and maximum X value.";
        return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#09111e";
    ctx.fillRect(0, 0, width, height);

    const scaleX = width / (maxX - minX);
    const scaleY = height / 20;

    const centerY = height / 2;

    function xPixel(x) {
        return (x - minX) * scaleX;
    }

    function yPixel(y) {
        return centerY - y * scaleY;
    }

    // Grid
    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.lineWidth = 1;

    const gridXStep = (maxX - minX) / 10;

    for (let x = minX; x <= maxX + gridXStep * 0.001; x += gridXStep) {
        const px = xPixel(x);

        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
    }

    for (let y = -10; y <= 10; y += 1) {
        const py = yPixel(y);

        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
        ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "rgba(190,200,225,0.65)";
    ctx.lineWidth = 1.3;

    ctx.beginPath();
    ctx.moveTo(xPixel(0), 0);
    ctx.lineTo(xPixel(0), height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, yPixel(0));
    ctx.lineTo(width, yPixel(0));
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "#8b9ab5";
    ctx.font = "10px Arial";
    ctx.fillText("0", xPixel(0) + 5, yPixel(0) - 6);

    if (!state.graphFunction) {
        $("graphMessage").textContent = "Enter a function and select Plot Function.";
        return;
    }

    // Function
    ctx.beginPath();
    ctx.strokeStyle = "#9b8cff";
    ctx.lineWidth = 2.3;

    let drawing = false;
    let plottedPoints = 0;

    for (let px = 0; px <= width; px += 1) {
        const x = minX + px / scaleX;

        try {
            const y = evaluate(state.graphFunction, state.angleMode, { x });
            const py = yPixel(y);

            if (!Number.isFinite(py) || Math.abs(py) > height * 4) {
                drawing = false;
                continue;
            }

            if (!drawing) {
                ctx.moveTo(px, py);
                drawing = true;
            } else {
                ctx.lineTo(px, py);
            }

            plottedPoints++;
        } catch {
            drawing = false;
        }
    }

    ctx.stroke();

    $("graphMessage").textContent =
        `Plotted f(x) = ${state.graphFunction}. ${plottedPoints} points evaluated.`;
}

function plotGraph() {
    const expression = $("graphExpression").value.trim();

    if (!expression) {
        showToast("Enter a function first.", "error");
        return;
    }

    try {
        evaluate(expression, state.angleMode, { x: 2 });
        state.graphFunction = expression;
        drawGraph();
    } catch (error) {
        showToast(error.message, "error");
    }
}

/* =========================================================
   9. EQUATION SOLVER
   ========================================================= */

function solveEquation() {
    const type = $("equationType").value;
    const a = Number($("coefficientA").value);
    const b = Number($("coefficientB").value);
    const c = Number($("coefficientC").value);

    const output = $("equationOutput");

    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
        output.innerHTML = '<p class="muted-text">Enter valid numerical coefficients.</p>';
        return;
    }

    if (type === "linear") {
        if (a === 0) {
            output.innerHTML = b === 0
                ? "<h3>Infinite solutions</h3><p>Every value of x satisfies the equation.</p>"
                : "<h3>No solution</h3><p>The equation is inconsistent.</p>";
            return;
        }

        const x = -b / a;

        output.innerHTML = `
            <h3>Linear Equation Solution</h3>
            <p>Given equation: ${formatNumber(a)}x + ${formatNumber(b)} = 0</p>
            <div class="step-item">Step 1: Move the constant to the other side.</div>
            <div class="step-item">Step 2: Divide both sides by the coefficient of x.</div>
            <div class="step-item">x = −b / a = ${formatNumber(x)}</div>
            <span class="solution-value">x = ${formatNumber(x)}</span>
        `;
        return;
    }

    if (a === 0) {
        output.innerHTML = '<p class="muted-text">For a quadratic equation, coefficient a must not be zero.</p>';
        return;
    }

    const discriminant = b * b - 4 * a * c;
    const d = formatNumber(discriminant);

    if (discriminant > 0) {
        const root1 = (-b + Math.sqrt(discriminant)) / (2 * a);
        const root2 = (-b - Math.sqrt(discriminant)) / (2 * a);

        output.innerHTML = `
            <h3>Two Real Roots</h3>
            <p>Discriminant: D = b² − 4ac = ${d}</p>
            <div class="step-item">Since D is positive, the equation has two distinct real roots.</div>
            <div class="step-item">x₁ = (−b + √D) / 2a</div>
            <div class="step-item">x₂ = (−b − √D) / 2a</div>
            <span class="solution-value">x₁ = ${formatNumber(root1)}</span>
            <span class="solution-value">x₂ = ${formatNumber(root2)}</span>
        `;
    } else if (discriminant === 0) {
        const root = -b / (2 * a);

        output.innerHTML = `
            <h3>One Repeated Real Root</h3>
            <p>Discriminant: D = ${d}</p>
            <div class="step-item">Since D = 0, both roots are equal.</div>
            <span class="solution-value">x = ${formatNumber(root)}</span>
        `;
    } else {
        const real = -b / (2 * a);
        const imaginary = Math.sqrt(-discriminant) / Math.abs(2 * a);

        output.innerHTML = `
            <h3>Complex Roots</h3>
            <p>Discriminant: D = ${d}</p>
            <div class="step-item">Since D is negative, the equation has two complex roots.</div>
            <span class="solution-value">x₁ = ${formatNumber(real)} + ${formatNumber(imaginary)}i</span>
            <span class="solution-value">x₂ = ${formatNumber(real)} − ${formatNumber(imaginary)}i</span>
        `;
    }
}

function updateEquationFields() {
    const isLinear = $("equationType").value === "linear";
    $("coefficientCGroup").style.display = isLinear ? "none" : "flex";
}

/* =========================================================
   10. MATRIX CALCULATOR
   ========================================================= */

function buildMatrixInputs() {
    const size = Number($("matrixSize").value);

    ["matrixA", "matrixB"].forEach((id, matrixIndex) => {
        const container = $(id);
        if (!container) return;

        container.innerHTML = "";
        container.classList.toggle("three-by-three", size === 3);

        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const input = document.createElement("input");

                input.type = "number";
                input.step = "any";
                input.className = "matrix-cell";
                input.value = matrixIndex === 0
                    ? (row === col ? "1" : "0")
                    : (row === col ? "2" : "0");

                input.setAttribute("aria-label", `Matrix ${matrixIndex === 0 ? "A" : "B"} row ${row + 1} column ${col + 1}`);

                container.appendChild(input);
            }
        }
    });

    updateMatrixOperation();
}

function readMatrix(id) {
    const inputs = [...$(id).querySelectorAll("input")];
    const size = Number($("matrixSize").value);

    const values = inputs.map(input => Number(input.value));

    if (values.some(value => !Number.isFinite(value))) {
        throw new Error("Enter valid numbers in every matrix cell.");
    }

    const matrix = [];

    for (let i = 0; i < size; i++) {
        matrix.push(values.slice(i * size, (i + 1) * size));
    }

    return matrix;
}

function matrixDeterminant(matrix) {
    const n = matrix.length;

    if (n === 1) return matrix[0][0];

    if (n === 2) {
        return matrix[0][0] * matrix[1][1] -
            matrix[0][1] * matrix[1][0];
    }

    let result = 0;

    for (let col = 0; col < n; col++) {
        const minor = matrix.slice(1).map(row =>
            row.filter((_, index) => index !== col)
        );

        result += (col % 2 === 0 ? 1 : -1) *
            matrix[0][col] * matrixDeterminant(minor);
    }

    return result;
}

function matrixInverse(matrix) {
    const n = matrix.length;
    const determinant = matrixDeterminant(matrix);

    if (Math.abs(determinant) < 1e-12) {
        throw new Error("This matrix is singular and has no inverse.");
    }

    const augmented = matrix.map((row, i) => [
        ...row,
        ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)
    ]);

    for (let i = 0; i < n; i++) {
        let pivot = i;

        for (let row = i + 1; row < n; row++) {
            if (Math.abs(augmented[row][i]) > Math.abs(augmented[pivot][i])) {
                pivot = row;
            }
        }

        [augmented[i], augmented[pivot]] = [augmented[pivot], augmented[i]];

        const divisor = augmented[i][i];

        if (Math.abs(divisor) < 1e-12) {
            throw new Error("This matrix is singular and has no inverse.");
        }

        for (let j = 0; j < 2 * n; j++) {
            augmented[i][j] /= divisor;
        }

        for (let row = 0; row < n; row++) {
            if (row === i) continue;

            const factor = augmented[row][i];

            for (let j = 0; j < 2 * n; j++) {
                augmented[row][j] -= factor * augmented[i][j];
            }
        }
    }

    return augmented.map(row => row.slice(n));
}

function matrixTranspose(matrix) {
    return matrix[0].map((_, col) =>
        matrix.map(row => row[col])
    );
}

function matrixMultiply(A, B) {
    const n = A.length;
    const result = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            for (let k = 0; k < n; k++) {
                result[i][j] += A[i][k] * B[k][j];
            }
        }
    }

    return result;
}

function renderMatrixResult(matrix, isScalar = false) {
    const output = $("matrixOutput");
    output.innerHTML = "";

    if (isScalar) {
        const title = document.createElement("h3");
        title.textContent = "Matrix Result";

        const value = document.createElement("span");
        value.className = "solution-value";
        value.textContent = formatNumber(matrix);

        output.append(title, value);
        return;
    }

    const title = document.createElement("h3");
    title.textContent = "Result Matrix";

    const grid = document.createElement("div");
    grid.className = "matrix-grid matrix-result";

    if (matrix.length === 3) {
        grid.classList.add("three-by-three");
    }

    matrix.forEach(row => {
        row.forEach(value => {
            const cell = document.createElement("div");
            cell.className = "matrix-cell";
            cell.style.display = "grid";
            cell.style.placeItems = "center";
            cell.textContent = formatNumber(value);
            grid.appendChild(cell);
        });
    });

    output.append(title, grid);
}

function calculateMatrix() {
    try {
        const A = readMatrix("matrixA");
        const operation = $("matrixOperation").value;

        let result;
        let scalar = false;

        if (operation === "determinant") {
            result = matrixDeterminant(A);
            scalar = true;
        } else if (operation === "inverse") {
            result = matrixInverse(A);
        } else if (operation === "transpose") {
            result = matrixTranspose(A);
        } else {
            const B = readMatrix("matrixB");

            if (operation === "add") {
                result = A.map((row, i) =>
                    row.map((value, j) => value + B[i][j])
                );
            } else if (operation === "subtract") {
                result = A.map((row, i) =>
                    row.map((value, j) => value - B[i][j])
                );
            } else if (operation === "multiply") {
                result = matrixMultiply(A, B);
            }
        }

        renderMatrixResult(result, scalar);
    } catch (error) {
        $("matrixOutput").textContent = error.message;
    }
}

function updateMatrixOperation() {
    const operation = $("matrixOperation").value;

    $("matrixBSection").style.display =
        ["determinant", "inverse", "transpose"].includes(operation)
            ? "none"
            : "block";
}

/* =========================================================
   11. STATISTICS CALCULATOR
   ========================================================= */

function calculateStatistics() {
    const raw = $("statisticsData").value.trim();

    const output = $("statisticsOutput");

    if (!raw) {
        showToast("Enter some numbers first.", "error");
        return;
    }

    const values = raw.split(/[\s,;]+/).filter(Boolean).map(Number);

    if (!values.length || values.some(value => !Number.isFinite(value))) {
        showToast("Enter only valid numbers separated by commas or spaces.", "error");
        return;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;

    const sum = values.reduce((total, value) => total + value, 0);
    const mean = sum / count;

    const median = count % 2 === 0
        ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
        : sorted[Math.floor(count / 2)];

    const frequencies = new Map();

    values.forEach(value => {
        frequencies.set(value, (frequencies.get(value) || 0) + 1);
    });

    const maxFrequency = Math.max(...frequencies.values());

    const modes = [...frequencies.entries()]
        .filter(([, frequency]) => frequency === maxFrequency)
        .map(([value]) => value);

    const variance = values.reduce(
        (total, value) => total + (value - mean) ** 2,
        0
    ) / count;

    const standardDeviation = Math.sqrt(variance);

    const cards = [
        ["Mean", formatNumber(mean)],
        ["Median", formatNumber(median)],
        ["Mode", maxFrequency === 1 ? "No mode" : modes.map(formatNumber).join(", ")],
        ["Variance", formatNumber(variance)],
        ["Std. Deviation", formatNumber(standardDeviation)],
        ["Count", String(count)]
    ];

    output.innerHTML = "";

    cards.forEach(([label, value]) => {
        const card = document.createElement("div");
        card.className = "stat-card";

        const title = document.createElement("span");
        title.textContent = label;

        const result = document.createElement("strong");
        result.textContent = value;

        card.append(title, result);
        output.appendChild(card);
    });

    showToast("Statistical analysis completed.");
}

/* =========================================================
   12. UNIT CONVERTER
   ========================================================= */

const UNIT_DATA = {
    length: {
        units: {
            m: 1,
            km: 1000,
            cm: 0.01,
            mm: 0.001,
            mile: 1609.344,
            yard: 0.9144,
            foot: 0.3048,
            inch: 0.0254
        }
    },

    mass: {
        units: {
            kg: 1,
            g: 0.001,
            mg: 0.000001,
            tonne: 1000,
            pound: 0.45359237,
            ounce: 0.028349523125
        }
    },

    area: {
        units: {
            "m²": 1,
            "km²": 1000000,
            "cm²": 0.0001,
            "ft²": 0.09290304,
            "acre": 4046.8564224,
            hectare: 10000
        }
    },

    volume: {
        units: {
            litre: 1,
            ml: 0.001,
            "m³": 1000,
            "cm³": 0.001,
            gallon: 3.785411784,
            cup: 0.2365882365
        }
    },

    speed: {
        units: {
            "m/s": 1,
            "km/h": 1 / 3.6,
            mph: 0.44704,
            knot: 0.514444444
        }
    },

    temperature: {
        units: {
            Celsius: "c",
            Fahrenheit: "f",
            Kelvin: "k"
        }
    }
};

function updateConversionOptions() {
    const category = $("conversionCategory").value;
    const units = Object.keys(UNIT_DATA[category].units);

    const from = $("conversionFrom");
    const to = $("conversionTo");

    from.innerHTML = "";
    to.innerHTML = "";

    units.forEach(unit => {
        const option1 = document.createElement("option");
        option1.value = unit;
        option1.textContent = unit;

        const option2 = option1.cloneNode(true);

        from.appendChild(option1);
        to.appendChild(option2);
    });

    if (units.length > 1) {
        to.selectedIndex = 1;
    }

    convertUnits();
}

function convertTemperature(value, from, to) {
    let celsius;

    if (from === "Celsius") celsius = value;
    else if (from === "Fahrenheit") celsius = (value - 32) * 5 / 9;
    else celsius = value - 273.15;

    if (to === "Celsius") return celsius;
    if (to === "Fahrenheit") return celsius * 9 / 5 + 32;

    return celsius + 273.15;
}

function convertUnits() {
    const category = $("conversionCategory").value;
    const value = Number($("conversionValue").value);
    const from = $("conversionFrom").value;
    const to = $("conversionTo").value;

    const resultElement = $("conversionOutput").querySelector("strong");

    if (!Number.isFinite(value)) {
        resultElement.textContent = "Enter a valid value";
        return;
    }

    let result;

    if (category === "temperature") {
        result = convertTemperature(value, from, to);
    } else {
        const units = UNIT_DATA[category].units;
        result = value * units[from] / units[to];
    }

    resultElement.textContent = `${formatNumber(result)} ${to}`;
}

/* =========================================================
   13. FORMULA LIBRARY
   ========================================================= */

const FORMULAS = [
    {
        name: "Quadratic Formula",
        category: "algebra",
        expression: "x = (-b ± √(b² - 4ac)) / 2a",
        description: "Finds the roots of a quadratic equation ax² + bx + c = 0."
    },
    {
        name: "Slope Formula",
        category: "algebra",
        expression: "m = (y₂ - y₁) / (x₂ - x₁)",
        description: "Calculates the slope between two points on a line."
    },
    {
        name: "Distance Formula",
        category: "geometry",
        expression: "d = √((x₂-x₁)² + (y₂-y₁)²)",
        description: "Calculates the distance between two points in a plane."
    },
    {
        name: "Area of Circle",
        category: "geometry",
        expression: "A = πr²",
        description: "Calculates the area of a circle using its radius."
    },
    {
        name: "Circumference of Circle",
        category: "geometry",
        expression: "C = 2πr",
        description: "Calculates the perimeter of a circle."
    },
    {
        name: "Pythagorean Theorem",
        category: "geometry",
        expression: "a² + b² = c²",
        description: "Relates the sides of a right-angled triangle."
    },
    {
        name: "Area of Triangle",
        category: "geometry",
        expression: "A = ½ × base × height",
        description: "Calculates the area of a triangle."
    },
    {
        name: "Volume of Sphere",
        category: "geometry",
        expression: "V = ⁴⁄₃πr³",
        description: "Calculates the volume of a sphere."
    },
    {
        name: "Sine Rule",
        category: "trigonometry",
        expression: "a/sin(A) = b/sin(B) = c/sin(C)",
        description: "Relates the sides and angles of a triangle."
    },
    {
        name: "Cosine Rule",
        category: "trigonometry",
        expression: "c² = a² + b² - 2ab cos(C)",
        description: "Finds a triangle side or angle."
    },
    {
        name: "Pythagorean Trigonometric Identity",
        category: "trigonometry",
        expression: "sin²(x) + cos²(x) = 1",
        description: "A fundamental trigonometric identity."
    },
    {
        name: "Derivative of Power",
        category: "calculus",
        expression: "d(xⁿ)/dx = nxⁿ⁻¹",
        description: "Differentiation rule for a power function."
    },
    {
        name: "Derivative of Sine",
        category: "calculus",
        expression: "d(sin x)/dx = cos x",
        description: "The derivative of sine is cosine."
    },
    {
        name: "Derivative of Cosine",
        category: "calculus",
        expression: "d(cos x)/dx = -sin x",
        description: "The derivative of cosine is negative sine."
    },
    {
        name: "Basic Integration Rule",
        category: "calculus",
        expression: "∫xⁿ dx = xⁿ⁺¹/(n+1) + C",
        description: "Power integration rule for n ≠ -1."
    },
    {
        name: "Integration of 1/x",
        category: "calculus",
        expression: "∫(1/x) dx = ln|x| + C",
        description: "The natural logarithmic integration rule."
    }
];

function renderFormulas() {
    const container = $("formulaGrid");
    if (!container) return;

    const search = $("formulaSearch").value.toLowerCase();

    const filtered = FORMULAS.filter(formula => {
        const categoryMatches =
            state.formulaCategory === "all" ||
            formula.category === state.formulaCategory;

        const searchMatches =
            formula.name.toLowerCase().includes(search) ||
            formula.expression.toLowerCase().includes(search) ||
            formula.description.toLowerCase().includes(search);

        return categoryMatches && searchMatches;
    });

    container.innerHTML = "";

    if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "muted-text";
        empty.textContent = "No formulas found. Try a different search.";
        container.appendChild(empty);
        return;
    }

    filtered.forEach(formula => {
        const card = document.createElement("article");
        card.className = "formula-card";

        const category = document.createElement("span");
        category.className = "formula-category";
        category.textContent = formula.category;

        const title = document.createElement("h3");
        title.textContent = formula.name;

        const expression = document.createElement("div");
        expression.className = "formula-expression";
        expression.textContent = formula.expression;

        const description = document.createElement("p");
        description.textContent = formula.description;

        card.append(category, title, expression, description);
        container.appendChild(card);
    });
}

function setupFormulaCategories() {
    document.querySelectorAll(".category-button").forEach(button => {
        button.addEventListener("click", () => {
            state.formulaCategory = button.dataset.category;

            document.querySelectorAll(".category-button").forEach(item => {
                item.classList.toggle("active", item === button);
            });

            renderFormulas();
        });
    });
}

/* =========================================================
   14. THEME SETTINGS
   ========================================================= */

function setupTheme() {
    const savedTheme = safeStorageGet("scicalcProTheme", "dark");

    if (savedTheme === "light") {
        document.body.classList.add("light-theme");
    }

    $("themeToggle").addEventListener("click", () => {
        document.body.classList.toggle("light-theme");

        const theme = document.body.classList.contains("light-theme")
            ? "light"
            : "dark";

        safeStorageSet("scicalcProTheme", theme);

        if (state.graphFunction && $("page-graph").classList.contains("active")) {
            drawGraph();
        }

        showToast(`${theme === "light" ? "Light" : "Dark"} theme enabled.`);
    });
}

/* =========================================================
   15. KEYBOARD SUPPORT
   ========================================================= */

function setupKeyboard() {
    document.addEventListener("keydown", event => {
        const target = event.target;

        if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement
        ) {
            if (target.id === "expression") {
                if (event.key === "Enter") {
                    event.preventDefault();
                    calculateExpression();
                } else if (event.key === "Escape") {
                    state.expression = "";
                    updateCalculatorDisplay();
                    showResult("0");
                }
            }

            return;
        }

        const key = event.key;

        if (/^[0-9.]$/.test(key)) {
            pressKey(key, key);
        } else if (["+", "-", "*", "/", "^", "%", "!", "(", ")"].includes(key)) {
            pressKey(key, key);
        } else if (key === "Enter" || key === "=") {
            event.preventDefault();
            calculateExpression();
        } else if (key === "Backspace") {
            pressKey("⌫", "back");
        } else if (key === "Escape") {
            pressKey("AC", "clear");
        }
    });
}

/* =========================================================
   16. COPY RESULT
   ========================================================= */

async function copyResult() {
    const text = $("result").textContent;

    if (!text || text === "0" || $("result").classList.contains("error")) {
        showToast("There is no valid result to copy.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        showToast("Result copied to clipboard.");
    } catch {
        const temporary = document.createElement("textarea");
        temporary.value = text;
        document.body.appendChild(temporary);
        temporary.select();

        try {
            document.execCommand("copy");
            showToast("Result copied.");
        } catch {
            showToast("Clipboard access is unavailable.", "error");
        }

        temporary.remove();
    }
}

/* =========================================================
   17. EVENT LISTENERS
   ========================================================= */

function setupNavigation() {
    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", () => {
            showPage(button.dataset.page);
        });
    });

    $("menuToggle").addEventListener("click", () => {
        $("sidebar").classList.toggle("open");
    });

    document.addEventListener("click", event => {
        const sidebar = $("sidebar");
        const menuButton = $("menuToggle");

        if (
            window.innerWidth <= 820 &&
            sidebar.classList.contains("open") &&
            !sidebar.contains(event.target) &&
            !menuButton.contains(event.target)
        ) {
            sidebar.classList.remove("open");
        }
    });
}

function setupCalculatorEvents() {
    $("angleToggle").addEventListener("click", () => {
        setAngleMode(state.angleMode === "deg" ? "rad" : "deg");
    });

    $("degMode").addEventListener("click", () => setAngleMode("deg"));
    $("radMode").addEventListener("click", () => setAngleMode("rad"));

    $("expression").addEventListener("input", event => {
        state.expression = event.target.value;
        state.completed = false;
    });

    $("expression").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            calculateExpression();
        }
    });

    document.querySelectorAll("[data-memory]").forEach(button => {
        button.addEventListener("click", () => {
            memoryOperation(button.dataset.memory);
        });
    });

    $("copyResult").addEventListener("click", copyResult);
    $("clearHistory").addEventListener("click", clearHistory);
    $("historySearch").addEventListener("input", renderHistory);
    $("exportHistory").addEventListener("click", exportHistory);
}

function setupGraphEvents() {
    $("plotGraph").addEventListener("click", plotGraph);

    $("resetGraph").addEventListener("click", () => {
        $("graphExpression").value = "";
        $("graphMin").value = "-10";
        $("graphMax").value = "10";
        state.graphFunction = null;
        drawGraph();
        $("graphMessage").textContent = "Graph reset.";
    });

    $("angleToggle").addEventListener("change", () => {
        if (state.graphFunction) drawGraph();
    });

    window.addEventListener("resize", () => {
        if ($("page-graph").classList.contains("active")) {
            drawGraph();
        }
    });
}

function setupToolEvents() {
    $("equationType").addEventListener("change", updateEquationFields);
    $("solveEquation").addEventListener("click", solveEquation);

    $("matrixSize").addEventListener("change", buildMatrixInputs);
    $("matrixOperation").addEventListener("change", updateMatrixOperation);
    $("calculateMatrix").addEventListener("click", calculateMatrix);

    $("calculateStatistics").addEventListener("click", calculateStatistics);

    $("conversionCategory").addEventListener("change", updateConversionOptions);
    $("convertUnits").addEventListener("click", convertUnits);
    $("conversionValue").addEventListener("input", convertUnits);
    $("conversionFrom").addEventListener("change", convertUnits);
    $("conversionTo").addEventListener("change", convertUnits);

    $("formulaSearch").addEventListener("input", renderFormulas);
    setupFormulaCategories();
}

/* =========================================================
   18. INITIALIZATION
   ========================================================= */

function initializeApp() {
    // Build calculator keypad
    buildKeypad();

    // Restore stored calculations
    loadHistory();

    // Navigation
    setupNavigation();

    // Calculator functionality
    setupCalculatorEvents();
    setupKeyboard();

    // Tool functionality
    setupGraphEvents();
    setupToolEvents();

    // Theme
    setupTheme();

    // Initialize modes and tools
    setAngleMode("deg");
    updateEquationFields();
    buildMatrixInputs();
    updateConversionOptions();
    renderFormulas();

    // Initial calculator state
    updateCalculatorDisplay();
    showResult("0");

    console.log("SciCalc Pro initialized successfully.");
}

document.addEventListener("DOMContentLoaded", initializeApp);
