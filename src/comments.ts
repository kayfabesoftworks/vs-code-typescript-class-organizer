export function removeComments(sourceCode: string) {
  const newLine = "\n";
  const emptyLine = "";
  let commentRegex = /^\/\/.*/;

  let commentsRegex = new RegExp(commentRegex, "i");
  let lines: string[] = sourceCode.split(newLine);
  let lines2: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!commentsRegex.test(lines[i].trim())) {
      lines2.push(lines[i]);
    } else {
      while (lines.length > i && lines[i] === emptyLine) {
        i++;
      }

      while (lines2.length > 0 && lines2[lines2.length - 1] === emptyLine) {
        lines2.pop();
      }
    }
  }

  return lines2.join(newLine);
}

export function formatComments(sourceCode: string) {
  const newLine = "\r\n";
  const newLinePlaceholder = "//newline";
  const cleanPlaceholder = "//clean";
  let newLineRegex = new RegExp(`\\s*${newLinePlaceholder}`, "g");
  let cleanRegex = new RegExp(`\\s*${cleanPlaceholder}`, "g");

  sourceCode = sourceCode.replace(newLineRegex, newLine);
  sourceCode = sourceCode.replace(cleanRegex, "");

  return sourceCode;
}

export function formatLines(sourceCode: string) {
  const newLine = "\r\n";
  let emptyLineRegex = new RegExp(`^\\s*$`);
  let newLineRegex = new RegExp(`\r?\n|\r`);
  let openingBraceRegex = new RegExp(`^.*\{\\s*$`);
  let closingBraceRegex = new RegExp(`^\\s*\}\\s*$`);

  let lines: string[] = sourceCode.split(newLineRegex);

  for (let i = 0; i < lines.length - 1; i++) {
    if (openingBraceRegex.test(lines[i]) && emptyLineRegex.test(lines[i + 1])) {
      // remove empty line after {
      lines.splice(i + 1, 1);

      i--;
    } else if (
      emptyLineRegex.test(lines[i]) &&
      closingBraceRegex.test(lines[i + 1])
    ) {
      // remove empty line before }
      lines.splice(i, 1);

      i--;
    } else if (
      emptyLineRegex.test(lines[i]) &&
      emptyLineRegex.test(lines[i + 1])
    ) {
      lines.splice(i, 1);

      i--;
    }
  }

  return lines.join(newLine);
}
