package ai.mergeproof.jetbrains;

import com.intellij.openapi.project.Project;

public final class AutofixAction extends CliAction {
    @Override protected String[] command(Project project, String input) { return npmCommand("autofix", input, "--repo", project.getBasePath(), "--verify", "npm test", "--re-review", "--json"); }
}
