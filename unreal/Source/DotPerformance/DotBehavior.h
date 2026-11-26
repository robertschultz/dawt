#pragma once

#include "CoreMinimal.h"

struct FDotBehaviorPose
{
    float Travel=0, Lift=0, Tilt=0, Turn=0, Nod=0, Squash=0;
    bool bWinding=false;
    float Depth=0;
};

enum class EDotBehaviorMove : uint8
{
    Hover, LookAround, HeadBob, TwoStep, Bounce, Glide, BodyRoll, Spin, Handoff, Twist, Shimmy, Jump, Flip, Jack, Skating, SalsaStep, HeelToe, RunningMan, PasDeBourree, Count
};

class FDotBehavior
{
public:
    void Load();
    void Save();
    FDotBehaviorPose Tick(float DeltaSeconds, double NativeBeat, float Bpm, float Energy, bool bPlaying, bool bOccupied, bool bHandoff);
    void Learn(const FString& MoveName, int32 Direction);

private:
    static constexpr int32 MoveCount=static_cast<int32>(EDotBehaviorMove::Count);
    float Preference[MoveCount]={};
    int32 TimesChosen[MoveCount]={};
    EDotBehaviorMove Current=EDotBehaviorMove::Hover;
    EDotBehaviorMove LastChoice=EDotBehaviorMove::Hover;
    EDotBehaviorMove RecentPerformance=EDotBehaviorMove::Hover;
    TArray<EDotBehaviorMove> Recent;
    FRandomStream Random;
    double BeatClock=0, PhraseStart=0;
    float Progress=1, PhraseBeats=4, Strength=.6f, Side=1, SaveAge=0;
    int32 Turns=2;
    int32 GroovePhrases=0;
    bool bWasPlaying=false, bWasOccupied=false, bWasHandoff=false, bDirty=false;
    bool bBeatAudit=false;
    int64 LastAuditedBeat=-1;

    void Choose(float Bpm, float Energy, bool bPlaying, bool bOccupied, bool bHandoff);
};
