package ai.mergeproof.jetbrains;

import com.intellij.openapi.project.Project;

public final class AnalyzePullRequestAction extends CliAction {
    @Override protected String[] command(Project project, String input) { return npmCommand("analyze", input, "--", "--json", "--repo", project.getBasePath()); }
}
