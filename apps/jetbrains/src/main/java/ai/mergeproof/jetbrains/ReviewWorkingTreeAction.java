package ai.mergeproof.jetbrains;

import com.intellij.openapi.project.Project;

public final class ReviewWorkingTreeAction extends CliAction {
    @Override protected String[] command(Project project, String input) { return npmCommand("review", project.getBasePath(), "--", "--json"); }
}
