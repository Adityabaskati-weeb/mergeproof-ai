package ai.mergeproof.jetbrains;

import com.intellij.openapi.project.Project;

public final class DocstringsAction extends CliAction {
    @Override protected String[] command(Project project, String input) {
        return npmCommand("docstrings", input, "--", "--json", "--repo", project.getBasePath());
    }
}
