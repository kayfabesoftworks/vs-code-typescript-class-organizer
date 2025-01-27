import { ElementNode } from "./elements/element-node";

export class ElementNodeGroup {
  // #region Constructors (1)

  constructor(
    public caption: string | null,
    public nodeSubGroups: ElementNodeGroup[],
    public nodes: ElementNode[],
    public isRegion: boolean,
    public isComment: boolean
  ) {}

  // #endregion Constructors (1)
}
