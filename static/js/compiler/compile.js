"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const coffee = require("coffee-script");
const detective = require("detective");
const less = require("less");
const yargs_1 = require("yargs");
const mkCoffeescriptError = (error, file) => {
    const message = error.message;
    if (error.location == null) {
        const text = [file || "<string>", message].join(":");
        return { message, text };
    }
    else {
        const location = error.location;
        const line = location.first_line + 1;
        const column = location.first_column + 1;
        const text = [file || "<string>", line, column, message].join(":");
        let markerLen = 2;
        if (location.first_line === location.last_line)
            markerLen += location.last_column - location.first_column;
        const extract = error.code.split('\n')[line - 1];
        const annotated = [
            text,
            "  " + extract,
            "  " + Array(column).join(' ') + Array(markerLen).join('^'),
        ].join('\n');
        return { message, line, column, text, extract, annotated };
    }
};
const mkLessError = (error, file) => {
    const message = error.message;
    const line = error.line;
    const column = error.column + 1;
    const text = [file || "<string>", line, column, message].join(":");
    const extract = error.extract[line];
    const annotated = [text, "  " + extract].join("\n");
    return { message, line, column, text, extract, annotated };
};
const mkTypeScriptError = (diagnostic) => {
    let { line, character: column } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    line += 1;
    column += 1;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const text = [diagnostic.file.fileName, line, column, message].join(":");
    return { message, line, column, text };
};
const reply = (data) => {
    process.stdout.write(JSON.stringify(data));
    process.stdout.write("\n");
};
const compile_and_resolve_deps = (input) => {
    let code;
    switch (input.lang) {
        case "coffeescript":
            try {
                code = coffee.compile(input.code, { bare: true, shiftLine: true });
            }
            catch (error) {
                return reply({ error: mkCoffeescriptError(error, input.file) });
            }
            break;
        case "javascript":
        case "typescript":
            code = input.code;
            break;
        case "less":
            const options = {
                paths: [path.dirname(input.file)],
                compress: true,
                ieCompat: false,
            };
            less.render(input.code, options, (error, output) => {
                if (error != null)
                    reply({ error: mkLessError(error, input.file) });
                else
                    reply({ code: output.css });
            });
            return;
        default:
            throw new Error(`unsupported input type: ${input.lang}`);
    }
    const result = ts.transpileModule(code, {
        fileName: input.file,
        reportDiagnostics: true,
        compilerOptions: {
            noEmitOnError: false,
            noImplicitAny: false,
            target: ts.ScriptTarget.ES5,
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.React,
            reactNamespace: "DOM",
        },
    });
    if (result.diagnostics != null && result.diagnostics.length > 0) {
        const diagnostic = result.diagnostics[0];
        return reply({ error: mkTypeScriptError(diagnostic) });
    }
    const source = result.outputText;
    try {
        const deps = detective(source);
        return reply({ code: source, deps: deps });
    }
    catch (error) {
        return reply({ error: error });
    }
};
if (yargs_1.argv.file != null) {
    const input = {
        code: fs.readFileSync(yargs_1.argv.file, "utf-8"),
        lang: yargs_1.argv.lang || "coffeescript",
        file: yargs_1.argv.file,
    };
    compile_and_resolve_deps(input);
}
else {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding("utf-8");
    let data = "";
    stdin.on("data", (chunk) => data += chunk);
    stdin.on("end", () => compile_and_resolve_deps(JSON.parse(data)));
}
