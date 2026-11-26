using UnrealBuildTool;

public class DotPerformanceEditorTarget : TargetRules
{
    public DotPerformanceEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("DotPerformance");
    }
}
