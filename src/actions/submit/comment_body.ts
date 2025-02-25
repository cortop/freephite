import { TContext } from '../../lib/context';
import { TBranchPRInfo } from '../../lib/engine/metadata_ref';

export interface PR extends Required<Pick<TBranchPRInfo, 'number' | 'base'>> {
  ref: string;
}

type Ref = PR['ref'];
type Trunk = TContext['engine']['trunk'];
type Tree = Record<Ref | Trunk, Array<PR | Pick<PR, 'base' | 'ref'>>>;
type Reverse = Record<Ref, Ref | Trunk>;

abstract class StackCommentBodyBase {
  protected tree: Tree;
  protected reverse: Reverse;
  protected comment: string;

  protected constructor(protected context: TContext, prs: Array<PR>) {
    this.tree = { [context.engine.trunk]: [] };
    this.reverse = {};

    // Populate tree with PR info
    for (const pr of prs) {
      this.addBranchToTree(pr);
    }

    // Fill the remaining path to trunk if necessary
    for (const base of Object.keys(this.tree)) {
      this.findRouteToTrunk(base);
    }

    this.comment = 'Current dependencies on/for this PR:\n\n';
    this.comment += this.buildTreeComment(undefined);
  }

  protected buildPRString(pr: PR): string {
    return `**PR #${pr.number}**`;
  }

  protected buildBranchRefString(ref: Pick<PR, 'base' | 'ref'>): string {
    const owner = this.context.repoConfig.getRepoOwner();
    const repo = this.context.repoConfig.getRepoName();
    return `Branch _${ref.ref}_ - [Create Pull Request](https://github.com/${owner}/${repo}/compare/${ref.base}...${ref.ref})`;
  }

  private addBranchToTree(branch: PR | Pick<PR, 'base' | 'ref'>) {
    const deps = this.tree[branch.base];
    // if (!deps || !deps.some((d) => d.ref === branch.ref)) {
    this.tree[branch.base] = deps ? [...deps, branch] : [branch];
    // }
    this.tree[branch.ref] = this.tree[branch.ref] ?? [];
    this.reverse[branch.ref] = branch.base;
  }

  private findRouteToTrunk(base: string): void {
    if (base === this.context.engine.trunk) {
      return;
    }

    if (base in this.reverse) {
      return this.findRouteToTrunk(this.reverse[base]);
    }

    const pr = this.context.engine.getPrInfo(base);

    // Add PR to tree and continue iterating to trunk
    if (pr && pr.base && pr.number) {
      this.addBranchToTree({
        base: pr.base,
        number: pr.number,
        ref: base,
      });

      return this.findRouteToTrunk(this.reverse[base]);
    }

    // If we don't have a PR, look up general branch info
    const parent = this.context.engine.getParent(base);
    if (parent) {
      this.addBranchToTree({ base: parent, ref: base });

      return this.findRouteToTrunk(this.reverse[base]);
    }
  }

  private buildTreeComment(
    pr: PR | Pick<PR, 'base' | 'ref'> | undefined,
    level = 0
  ): string {
    const trunk = this.context.engine.trunk;
    let line = ' '.repeat(level * 2) + '* ';
    if (pr === undefined) {
      line += `${trunk}:\n`;
    } else if ('number' in pr) {
      line += this.buildPRString(pr) + '\n';
    } else {
      line += this.buildBranchRefString(pr) + '\n';
    }

    const children = pr === undefined ? this.tree[trunk] : this.tree[pr.ref];

    return line.concat(
      children.map((c) => this.buildTreeComment(c, level + 1)).join('')
    );
  }
}

/**
 * External API for generating a comment from a PR stack
 *
 * const body = StackCommentBody.generate(context: TContext, prs: Array<PR>)
 * const withPointer = body.forPR(pr: PR);
 *
 */
export class StackCommentBody extends StackCommentBodyBase {
  public static generate(context: TContext, prs: Array<PR>): StackCommentBody {
    return new this(context, prs);
  }

  public forPR(pr: PR): string {
    const line = this.buildPRString(pr);
    const index = this.comment.indexOf(line);

    return (
      this.comment.slice(0, index + line.length) +
      ' 👈' +
      this.comment.slice(index + line.length)
    );
  }

  public toString(): string {
    return this.comment;
  }
}
