import { Configuration } from "./src/configuration";
import { ElementNodeGroup } from "./src/element-node-group";
import { ElementNodeGroupConfiguration } from "./src/element-node-group-configuration";
import { ClassNode } from "./src/elements/class-node";
import { ElementNode } from "./src/elements/element-node";
import { GetterNode } from "./src/elements/getter-node";
import { InterfaceNode } from "./src/elements/interface-node";
import { MethodNode } from "./src/elements/method-node";
import { PropertyNode } from "./src/elements/property-node";
import { SetterNode } from "./src/elements/setter-node";
import { UnknownNode } from "./src/elements/unknown-node";
import { MemberType } from "./src/member-type";
import { formatLines, removeComments } from "./src/comments";
import { Transformer } from "./src/transformer";
import {
  compareNumbers,
  getClasses,
  getEnums,
  getFunctions,
  getImports,
  getInterfaces,
  getTypeAliases,
} from "./src/utils";
import * as ts from "typescript";
import * as vscode from "vscode";
import { removeRegions } from "./src/regions";
import * as _ from "lodash";

let configuration = getConfiguration();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("tscoc.organize", () =>
      organize(vscode.window.activeTextEditor, configuration)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("tscoc.organizeAll", () =>
      organizeAll(configuration)
    )
  );

  vscode.workspace.onDidChangeConfiguration(
    (e) => (configuration = getConfiguration())
  );

  vscode.workspace.onWillSaveTextDocument((e) => {
    if (
      vscode.window.activeTextEditor &&
      vscode.window.activeTextEditor.document.fileName == e.document.fileName
    ) {
      if (configuration.organizeOnSave) {
        organize(vscode.window.activeTextEditor, getConfiguration());
      }
    }
  });
}

function getConfiguration() {
  let configuration = vscode.workspace.getConfiguration("tscoc");

  return new Configuration(
    configuration.get<boolean>("useRegions") === true,
    configuration.get<boolean>("useComments") === true,
    configuration.get<boolean>("addPublicModifierIfMissing") === true,
    configuration.get<boolean>("accessorsBeforeCtor") === true,
    configuration.get<boolean>("addRowNumberInRegionName") === true,
    configuration.get<boolean>("addRegionIndentation") === true,
    configuration.get<boolean>("addRegionCaptionToRegionEnd") === true,
    configuration.get<boolean>("groupPropertiesWithDecorators") === true,
    configuration.get<boolean>("treatArrowFunctionPropertiesAsMethods") ===
      true,
    configuration.get<boolean>("organizeOnSave") === true,
    getMemberOrderConfig()
  );
}

function getMemberOrderConfig(): ElementNodeGroupConfiguration[] {
  let memberTypeOrderConfiguration =
    vscode.workspace
      .getConfiguration("tscoc")
      .get<ElementNodeGroupConfiguration[]>("memberOrder") || [];
  let memberTypeOrder: ElementNodeGroupConfiguration[] = [];
  let defaultMemberTypeOrder = Object.keys(MemberType) // same order as in the enum
    .filter((x) => !isNaN(parseInt(x, 10))) // do not include int value
    .map((x) => <MemberType>parseInt(x, 10));
  memberTypeOrderConfiguration.forEach((x: any) =>
    memberTypeOrder.push(parseElementNodeGroupConfiguration(x))
  );
  defaultMemberTypeOrder
    .filter(
      (x) =>
        !memberTypeOrder.some(
          (y) =>
            y.memberTypes &&
            y.memberTypes.length > 0 &&
            y.memberTypes.some((z) => z === x)
        )
    )
    .forEach((x) => {
      let defaultElementNodeGroupConfiguration =
        new ElementNodeGroupConfiguration();

      defaultElementNodeGroupConfiguration.caption =
        convertPascalCaseToTitleCase(MemberType[x]);
      defaultElementNodeGroupConfiguration.memberTypes = [x];

      memberTypeOrder.push(defaultElementNodeGroupConfiguration);
    });

  return memberTypeOrder;
}

function convertPascalCaseToTitleCase(value: string) {
  if (value && value.length > 1) {
    value = _.startCase(value);
  }

  return value;
}

function parseElementNodeGroupConfiguration(x: any) {
  let elementNodeGroupConfiguration = new ElementNodeGroupConfiguration();

  elementNodeGroupConfiguration.caption = x.caption;
  elementNodeGroupConfiguration.memberTypes = (x.memberTypes as string[]).map(
    (y) => MemberType[y as keyof typeof MemberType]
  );

  return elementNodeGroupConfiguration;
}

function getIndentation(sourceCode: string): string {
  let tab = "\t";
  let twoSpaces = "  ";
  let fourSpaces = "    ";

  for (const sourceCodeLine of sourceCode.split("\n")) {
    if (sourceCodeLine.startsWith(tab)) {
      return tab;
    } else if (sourceCodeLine.startsWith(fourSpaces)) {
      return fourSpaces;
    } else if (sourceCodeLine.startsWith(twoSpaces)) {
      return twoSpaces;
    }
  }

  return twoSpaces;
}

function organizeAll(configuration: Configuration) {
  vscode.workspace
    .findFiles("**/*.ts")
    .then((typescriptFiles) =>
      typescriptFiles.forEach((typescriptFile) =>
        vscode.workspace
          .openTextDocument(typescriptFile)
          .then((document) =>
            vscode.window
              .showTextDocument(document)
              .then((editor) => organize(editor, configuration) !== null)
          )
      )
    );
}

function organize(
  editor: vscode.TextEditor | undefined,
  configuration: Configuration
) {
  let edit: vscode.WorkspaceEdit;
  let start: vscode.Position;
  let end: vscode.Position;
  let range: vscode.Range;

  if (editor) {
    let sourceCode = editor.document.getText();
    let fileName = editor.document.fileName;

    sourceCode = organizeTypes(sourceCode, fileName, configuration);

    start = new vscode.Position(0, 0);
    end = new vscode.Position(
      editor.document.lineCount,
      editor.document.lineAt(editor.document.lineCount - 1).text.length
    );
    range = new vscode.Range(start, end);

    edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, range, sourceCode);

    return vscode.workspace.applyEdit(edit);
  }
}

function print(
  groups: ElementNodeGroup[],
  sourceCode: string,
  start: number,
  end: number,
  IndentationLevel: number,
  addRowNumberInRegionName: boolean,
  addPublicModifierIfMissing: boolean,
  addRegionIndentation: boolean,
  Indentation: string,
  addRegionCaptionToRegionEnd: boolean,
  groupElementsWithDecorators: boolean
) {
  let sourceCode2: string;
  let count = 0;
  let members = "";
  let newLine = "\r\n";
  let nodeGroups: ElementNode[][] = [];

  for (let group of groups) {
    if (group.nodes && group.nodes.length > 0) {
      count = group.nodes.length;
      nodeGroups = [group.nodes];
    } else if (group.nodeSubGroups && group.nodeSubGroups.length > 0) {
      count = group.nodeSubGroups.reduce((sum, x) => sum + x.nodes.length, 0);
      nodeGroups = group.nodeSubGroups
        .map((x) => x.nodes)
        .filter((x) => x.length > 0);
    } else {
      count = 0;
      nodeGroups = [];
    }

    if (count > 0) {
      if (group.isRegion) {
        members += newLine;
        members += `${addRegionIndentation ? Indentation : ""}// #region`;
        members += group.caption ? ` ${group.caption}` : "";
        members += addRowNumberInRegionName ? ` (${count})` : "";
        members += newLine;
      }

      if (group.isComment) {
        members += newLine;
        members += `${
          addRegionIndentation ? Indentation : ""
        }// -------------------------------------------------------------------`;
        members += newLine;
        members += `${addRegionIndentation ? Indentation : ""}// ${
          group.caption ? `${group.caption}` : ""
        }`;
        members += newLine;
        members += `${
          addRegionIndentation ? Indentation : ""
        }// -------------------------------------------------------------------`;
        members += newLine;
      }

      members += newLine;

      for (let nodeGroup of nodeGroups) {
        for (let i = 0; i < nodeGroup.length; i++) {
          const node = nodeGroup[i];
          let comment = sourceCode.substring(node.fullStart, node.start).trim();
          let code = sourceCode.substring(node.start, node.end).trim();

          if (addPublicModifierIfMissing) {
            if (node.accessModifier === null) {
              if (node instanceof MethodNode) {
                if (code.startsWith("static")) {
                  if (code.startsWith("static async")) {
                    code = code.replace(
                      new RegExp(`static\\s*async\\s*${node.name}\\s*\\(`),
                      `public static async ${node.name}(`
                    );
                  } else {
                    code = code.replace(
                      new RegExp(`static\\s*${node.name}\\s*\\(`),
                      `public static ${node.name}(`
                    );
                  }
                } else {
                  if (code.startsWith("async")) {
                    code = code.replace(
                      new RegExp(`async\\s*${node.name}\\s*\\(`),
                      `public async ${node.name}(`
                    );
                  } else {
                    code = code.replace(
                      new RegExp(`${node.name}\\s*\\(`),
                      `public ${node.name}(`
                    );
                  }
                }
              } else if (node instanceof PropertyNode) {
                if (code.startsWith("static")) {
                  code = code.replace(
                    new RegExp(`static\\s*${node.name}\\s*:`),
                    `public static ${node.name}:`
                  );
                  code = code.replace(
                    new RegExp(`static\\s*${node.name}\\s*=`),
                    `public static ${node.name} =`
                  );
                  code = code.replace(
                    new RegExp(`static\\s*${node.name}\\s*;`),
                    `public static ${node.name};`
                  );
                } else {
                  code = code.replace(
                    new RegExp(`${node.name}\\s*:`),
                    `public ${node.name}:`
                  );
                  code = code.replace(
                    new RegExp(`${node.name}\\s*=`),
                    `public ${node.name} =`
                  );
                  code = code.replace(
                    new RegExp(`${node.name}\\s*;`),
                    `public ${node.name};`
                  );
                }
              } else if (node instanceof GetterNode) {
                if (code.startsWith("static")) {
                  code = code.replace(
                    new RegExp(`static\\s*get\\s*${node.name}\\s*\\(`),
                    `public static get ${node.name}(`
                  );
                } else {
                  code = code.replace(
                    new RegExp(`get\\s*${node.name}\\s*\\(`),
                    `public get ${node.name}(`
                  );
                }
              } else if (node instanceof SetterNode) {
                if (code.startsWith("static")) {
                  code = code.replace(
                    new RegExp(`static\\s*set\\s*${node.name}\\s*\\(`),
                    `public static set ${node.name}(`
                  );
                } else {
                  code = code.replace(
                    new RegExp(`set\\s*${node.name}\\s*\\(`),
                    `public set ${node.name}(`
                  );
                }
              }
            }
          }

          if (groupElementsWithDecorators) {
            if (i > 0) {
              if (
                nodeGroup[i - 1].decorators.length > 0 &&
                nodeGroup[i].decorators.length === 0
              ) {
                members += newLine;
              }
            }
          }

          if (comment !== "") {
            members += `${
              IndentationLevel === 1 ? Indentation : ""
            }${comment}${newLine}`;
          }

          members += `${IndentationLevel === 1 ? Indentation : ""}${code}`;
          members += newLine;

          if (code.endsWith("}")) {
            members += newLine;
          } else if (node instanceof PropertyNode && node.isArrowFunction) {
            members += newLine;
          }
        }

        members += newLine;
      }

      if (group.isRegion) {
        members += newLine;
        members += `${addRegionIndentation ? Indentation : ""}// #endregion`;
        members += addRegionCaptionToRegionEnd ? ` ${group.caption}` : "";
        members += addRowNumberInRegionName ? ` (${count})` : "";
        members += newLine;
      }

      members += newLine;
    }
  }

  sourceCode2 = sourceCode.substring(0, start).trimRight();
  sourceCode2 += newLine;
  sourceCode2 += (addRegionIndentation ? Indentation : "") + members.trim();
  sourceCode2 += newLine;
  sourceCode2 += sourceCode.substring(end, sourceCode.length).trimLeft();

  return sourceCode2.trimLeft();
}

function organizeTypes(
  sourceCode: string,
  fileName: string,
  configuration: Configuration
) {
  sourceCode = removeComments(sourceCode);

  let indentation = getIndentation(sourceCode);
  let sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );

  let elements = new Transformer().analyzeSyntaxTree(
    sourceFile,
    configuration.treatArrowFunctionPropertiesAsMethods
  );

  if (!elements.some((x) => !(x instanceof UnknownNode))) {
    let imports = getImports(
      elements,
      configuration.groupPropertiesWithDecorators
    );
    let functions = getFunctions(
      elements,
      configuration.groupPropertiesWithDecorators
    );
    let typeAliases = getTypeAliases(
      elements,
      configuration.groupPropertiesWithDecorators
    );
    let interfaces = getInterfaces(
      elements,
      configuration.groupPropertiesWithDecorators
    );
    let classes = getClasses(
      elements,
      configuration.groupPropertiesWithDecorators
    );
    let enums = getEnums(elements, configuration.groupPropertiesWithDecorators);

    let groups = [
      new ElementNodeGroup("Imports", [], imports, false, true),
      new ElementNodeGroup("Type aliases", [], typeAliases, true, true),
      new ElementNodeGroup("Interfaces", [], interfaces, true, true),
      new ElementNodeGroup("Classes", [], classes, true, true),
      new ElementNodeGroup("Enums", [], enums, true, true),
      new ElementNodeGroup("Functions", [], functions, true, true),
    ];

    if (
      functions.length +
        typeAliases.length +
        interfaces.length +
        classes.length +
        enums.length >
        1 ||
      functions.length > 0
    ) {
      sourceCode = print(
        groups,
        sourceCode,
        0,
        sourceCode.length,
        0,
        configuration.addRowNumberInRegionName,
        false,
        false,
        indentation,
        configuration.addRegionCaptionToRegionEnd,
        configuration.groupPropertiesWithDecorators
      );
    }
  }
  sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );

  elements = new Transformer().analyzeSyntaxTree(
    sourceFile,
    configuration.treatArrowFunctionPropertiesAsMethods
  );

  for (let element of elements.sort(
    (a, b) => compareNumbers(a.fullStart, b.fullStart) * -1
  )) {
    if (element instanceof InterfaceNode) {
      let interfaceNode = <InterfaceNode>element;
      let groups = organizeInterfaceMembers(
        interfaceNode,
        configuration.memberOrder,
        configuration.groupPropertiesWithDecorators
      );

      sourceCode = print(
        groups,
        sourceCode,
        interfaceNode.membersStart,
        interfaceNode.membersEnd,
        1,
        configuration.addRowNumberInRegionName,
        false,
        configuration.addRegionIndentation,
        indentation,
        configuration.addRegionCaptionToRegionEnd,
        configuration.groupPropertiesWithDecorators
      );
    } else if (element instanceof ClassNode) {
      let classNode = <ClassNode>element;
      let groups = organizeClassMembers(
        classNode,
        configuration.memberOrder,
        configuration.groupPropertiesWithDecorators
      );

      sourceCode = print(
        groups,
        sourceCode,
        classNode.membersStart,
        classNode.membersEnd,
        1,
        configuration.addRowNumberInRegionName,
        configuration.addPublicModifierIfMissing,
        configuration.addRegionIndentation,
        indentation,
        configuration.addRegionCaptionToRegionEnd,
        configuration.groupPropertiesWithDecorators
      );
    }
  }

  if (!configuration.useRegions) {
    sourceCode = removeRegions(sourceCode);
  }

  sourceCode = formatLines(sourceCode);
  return sourceCode;
}

function organizeInterfaceMembers(
  interfaceNode: InterfaceNode,
  memberTypeOrder: ElementNodeGroupConfiguration[],
  groupElementsWithDecorators: boolean
) {
  let regions: ElementNodeGroup[] = [];
  let memberGroups: ElementNodeGroup[];

  for (const memberTypeGroup of memberTypeOrder) {
    memberGroups = [];

    for (const memberType of memberTypeGroup.memberTypes) {
      if (memberType === MemberType.publicConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            interfaceNode.getConstProperties(groupElementsWithDecorators),
            false,
            true
          )
        );
      } else if (memberType === MemberType.publicReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            interfaceNode.getReadOnlyProperties(groupElementsWithDecorators),
            false,
            true
          )
        );
      } else if (memberType === MemberType.publicProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            interfaceNode.getProperties(groupElementsWithDecorators),
            false,
            true
          )
        );
      } else if (memberType === MemberType.publicIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            interfaceNode.getIndexes(groupElementsWithDecorators),
            false,
            true
          )
        );
      } else if (memberType === MemberType.publicMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            interfaceNode.getMethods(groupElementsWithDecorators),
            false,
            true
          )
        );
      }
    }

    regions.push(
      new ElementNodeGroup(
        memberTypeGroup.caption,
        memberGroups,
        [],
        true,
        true
      )
    );
  }

  return regions;
}

function organizeClassMembers(
  classNode: ClassNode,
  memberTypeOrder: ElementNodeGroupConfiguration[],
  groupElementsWithDecorators: boolean
): ElementNodeGroup[] {
  let regions: ElementNodeGroup[] = [];
  let memberGroups: ElementNodeGroup[];

  for (const memberTypeGroup of memberTypeOrder) {
    memberGroups = [];

    for (const memberType of memberTypeGroup.memberTypes) {
      if (memberType === MemberType.privateStaticConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateStaticConstProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateConstProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateStaticReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateStaticReadOnlyProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateReadOnlyProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateStaticProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateStaticProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedStaticConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedStaticConstProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedConstProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedStaticReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedStaticReadOnlyProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedReadOnlyProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedStaticProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedStaticProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicStaticConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicStaticConstProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicConstProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicConstProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicStaticReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicStaticReadOnlyProperties(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicReadOnlyProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicReadOnlyProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicStaticProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicStaticProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicProperties) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicProperties(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.constructors) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getConstructors(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicStaticIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicStaticIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicAbstractIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicAbstractIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedStaticIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedStaticIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedAbstractIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedAbstractIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateStaticIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateStaticIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateAbstractIndexes) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateAbstractIndexes(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicStaticGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicStaticGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicGettersAndSetters(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicAbstractGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicAbstractGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedStaticGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedStaticGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedAbstractGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedAbstractGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateStaticGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateStaticGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateGettersAndSetters(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateAbstractGettersAndSetters) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateAbstractGettersAndSetters(
              groupElementsWithDecorators
            ),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicStaticMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicStaticMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.publicAbstractMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPublicAbstractMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedStaticMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedStaticMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.protectedAbstractMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getProtectedAbstractMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateStaticMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateStaticMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      } else if (memberType === MemberType.privateAbstractMethods) {
        memberGroups.push(
          new ElementNodeGroup(
            null,
            [],
            classNode.getPrivateAbstractMethods(groupElementsWithDecorators),
            false,
            false
          )
        );
      }
    }

    regions.push(
      new ElementNodeGroup(
        memberTypeGroup.caption,
        memberGroups,
        [],
        true,
        true
      )
    );
  }

  return regions;
}
