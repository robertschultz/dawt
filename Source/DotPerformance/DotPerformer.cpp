#include "DotPerformer.h"

#include "Components/StaticMeshComponent.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
struct FDotPose
{
    float Travel = 0, Lift = 0, Tilt = 0, Turn = 0, Nod = 0, Squash = 0;
};

float Wave(float Time, float Period)
{
    return FMath::Sin(UE_TWO_PI * Time / Period);
}

float Hop(float Time, float Period)
{
    return FMath::Max(0.f, Wave(Time, Period));
}

FDotPose Perform(EDotMove Mode, float Time)
{
    const float Phase = FMath::Fmod(Time, 16.f);
    float T = Time;
    EDotMove Move = Mode;
    if (Mode == EDotMove::Show)
    {
        const int32 Part = FMath::FloorToInt(Phase / 4.f);
        static constexpr EDotMove Moves[] = {EDotMove::Bounce, EDotMove::Glide, EDotMove::Spin, EDotMove::Dance};
        Move = Moves[Part];
        T = FMath::Fmod(Phase, 4.f);
    }

    FDotPose Pose;
    if (Move == EDotMove::Bounce)
    {
        Pose = {0, 44*Hop(T, .5f), 6*Wave(T, 1), 7*Wave(T, 2), 9*Wave(T+.10f, .5f), .12f*Wave(T, .5f)};
    }
    else if (Move == EDotMove::Glide)
    {
        Pose = {125*Wave(T, 4), 20*Hop(T, .5f), -15*Wave(T+1, 4), -16*Wave(T+1, 4), 5*Wave(T, .5f), .045f*Wave(T, .5f)};
    }
    else if (Move == EDotMove::Spin)
    {
        const float Segment = FMath::Fmod(T, 2.f)/2;
        const float Eased = FMath::SmoothStep(0.f, 1.f, Segment);
        Pose = {32*Wave(T, 2), 49*FMath::Sin(UE_PI*Segment), 12*Wave(T, 2), 360*Eased, 9*Wave(T, 1), .08f*Wave(T, 1)};
    }
    else
    {
        const float TwoStep = Wave(T, 2);
        Pose = {58*TwoStep, 32*Hop(T, .5f), -17*TwoStep, 24*Wave(T+.13f, 1), 14*Wave(T+.07f, .5f), .09f*Wave(T, .5f)};
    }

    if (Mode == EDotMove::Show)
    {
        const float Envelope = FMath::SmoothStep(0.f, .23f, T) * (1.f - FMath::SmoothStep(3.77f, 4.f, T));
        Pose.Travel *= Envelope;
        Pose.Lift *= Envelope;
        Pose.Tilt *= Envelope;
        Pose.Turn = FMath::UnwindDegrees(Pose.Turn) * Envelope;
        Pose.Nod *= Envelope;
        Pose.Squash *= Envelope;
    }
    return Pose;
}

}

ADotPerformer::ADotPerformer()
{
    PrimaryActorTick.bCanEverTick = true;
    Anchor = CreateDefaultSubobject<USceneComponent>(TEXT("DotAnchor"));
    SetRootComponent(Anchor);
    PosePivot = CreateDefaultSubobject<USceneComponent>(TEXT("MotionPivot"));
    PosePivot->SetupAttachment(Anchor);

    Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BodyAndEyes"));
    Headphones = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RemovableHeadphones"));
    static const ConstructorHelpers::FObjectFinder<UStaticMesh> BodyMesh(TEXT("/Game/Dot/Meshes/DotBody.DotBody"));
    static const ConstructorHelpers::FObjectFinder<UStaticMesh> HeadphoneMesh(TEXT("/Game/Dot/Meshes/DotHeadphones.DotHeadphones"));
    Body->SetStaticMesh(BodyMesh.Object);
    Headphones->SetStaticMesh(HeadphoneMesh.Object);
    for (UStaticMeshComponent* Part : {Body.Get(), Headphones.Get()})
    {
        Part->SetupAttachment(PosePivot);
        Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        // FBX import mirrors Blender's Y axis for Unreal's handedness.
        Part->SetRelativeRotation(FRotator(0,180,0));
    }
}

void ADotPerformer::BeginPlay()
{
    Super::BeginPlay();
    ActiveMove = InitialMove;
    bPaused = !bPlayOnStart;
    SetHeadphonesVisible(bWearHeadphonesOnStart);
    Behavior.Load();
}

void ADotPerformer::EndPlay(const EEndPlayReason::Type Reason)
{
    Behavior.Save();
    Super::EndPlay(Reason);
}

void ADotPerformer::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!bPaused) Time += DeltaSeconds;
    TalkAge+=DeltaSeconds;
    AttentionHold=FMath::Max(0.f,AttentionHold-DeltaSeconds);
    if (TalkAge<.55f && Talk.Phase!=EDotTalkPhase::Idle && Talk.Phase!=EDotTalkPhase::Listening)
        AttentionHold=.85f;

    FDotPose Pose;
    bool bWinding=false;
    bool bGrooving=false;
    float Depth=0;
    if (!bMusicMode) Pose=Perform(ActiveMove,Time);
    if (bMusicMode)
    {
        const double Now=FPlatformTime::Seconds();
        const double SampleAge=Now-MusicSampleAt;
        const float ClockDelta=MusicTickAt>0 ? float(Now-MusicTickAt) : DeltaSeconds;
        MusicTickAt=Now;
        GestureAge += DeltaSeconds;
        bGrooving = Music.bPlaying && SampleAge < 2.25f;
        MusicEnergy=FMath::Lerp(MusicEnergy,Music.Energy,1.f-FMath::Exp(-DeltaSeconds*1.8f));
        const bool bTalking=AttentionHold>0;
        const bool bWorking=Music.bMixing || (Music.bScheduled && Gesture==TEXT("mix"));
        const float Focus=(Music.bMixing || Music.bScheduled ? Music.Incoming : Music.Deck)==0 ? -1.f : 1.f;
        const float TaskTarget=bWorking && bGrooving ? Focus : 0.f;
        TaskLean=FMath::Lerp(TaskLean,TaskTarget,1.f-FMath::Exp(-DeltaSeconds*3.f));

        const double NativeBeat=Music.Beat+SampleAge*Music.Bpm/60.0;
        const auto Move=Behavior.Tick(bGrooving ? ClockDelta : DeltaSeconds,NativeBeat,Music.Bpm,MusicEnergy,bGrooving,
            bTalking||bCrateEngaged,Gesture==TEXT("handoff")&&GestureAge<.55f);
        bWinding=Move.bWinding;
        Depth=Move.Depth;
        Pose.Travel=Move.Travel+13.f*TaskLean;
        Pose.Lift=Move.Lift+(bGrooving ? 0.f : 2.4f*Wave(Time,3.8f));
        Pose.Tilt=Move.Tilt-7.f*TaskLean;
        Pose.Turn=Move.Turn-10.f*TaskLean;
        Pose.Nod=Move.Nod-6.f*FMath::Abs(TaskLean);
        Pose.Squash=Move.Squash;

    }
    const bool bPassiveWhilePlaying=bGrooving &&
        Talk.Phase==EDotTalkPhase::Listening && AttentionHold<=0;
    const bool bTalkFresh = TalkAge<.55f && Talk.Phase!=EDotTalkPhase::Idle && !bPassiveWhilePlaying;
    TalkBlend = FMath::FInterpTo(TalkBlend,bTalkFresh ? 1.f : 0.f,DeltaSeconds,6.f);
    VoiceLevel = FMath::FInterpTo(VoiceLevel,bTalkFresh ? Talk.Level : 0.f,DeltaSeconds,13.f);
    if (TalkBlend>.001f)
    {
        FDotPose Reaction;
        Reaction.Lift=3.f*Wave(Time,3.4f);
        switch (Talk.Phase)
        {
            case EDotTalkPhase::Hearing:
                Reaction.Nod=-7.f-5.f*Hop(Time,.74f)-4.f*VoiceLevel;
                Reaction.Tilt=9;
                break;
            case EDotTalkPhase::Speaking:
                Reaction.Nod=-3.f-13.f*VoiceLevel+3.f*Wave(Time,.49f);
                Reaction.Tilt=4.f*Wave(Time,1.37f);
                Reaction.Lift+=12.f*VoiceLevel;
                Reaction.Squash=.045f*VoiceLevel;
                break;
            case EDotTalkPhase::Working:
                Reaction.Turn=12.f*Wave(Time,2.2f);
                Reaction.Nod=-11.f;
                Reaction.Tilt=6.f*Wave(Time,2.2f);
                break;
            default:
                Reaction.Tilt=5;
                Reaction.Nod=-2;
                break;
        }
        switch (Talk.Mood)
        {
            case EDotMood::Warm: Reaction.Nod-=6.f*Hop(Time,1.17f); break;
            case EDotMood::Curious: Reaction.Tilt+=9.f; break;
            case EDotMood::Excited: Reaction.Lift+=15.f*Hop(Time,.61f); Reaction.Squash+=.025f*Wave(Time,.61f); break;
            case EDotMood::Concerned: Reaction.Tilt-=7.f; Reaction.Lift-=5.f; break;
            default: break;
        }
        Pose.Travel*=1.f-.85f*TalkBlend;
        Depth*=1.f-TalkBlend;
        Pose.Lift=FMath::Lerp(Pose.Lift,Reaction.Lift,TalkBlend*.84f);
        Pose.Nod=FMath::Lerp(Pose.Nod,Reaction.Nod,TalkBlend*.92f);
        Pose.Tilt=FMath::Lerp(Pose.Tilt,Reaction.Tilt,TalkBlend*.88f);
        Pose.Turn=FMath::Lerp(FMath::UnwindDegrees(Pose.Turn),Reaction.Turn,TalkBlend*.90f);
        Pose.Squash=FMath::Lerp(Pose.Squash,Reaction.Squash,TalkBlend*.76f);
    }
    bDanceAccent=bMusicMode && TalkBlend<.05f && (bWinding || Pose.Lift>42.f);
    const float Settle=1.f-FMath::Exp(-DeltaSeconds*(bGrooving ? 25.f : 16.f));
    const FVector Position(FMath::Clamp(Pose.Travel + ManualTravel,-190.f,190.f),Depth,Pose.Lift);
    PosePivot->SetRelativeLocation(FMath::Lerp(PosePivot->GetRelativeLocation(),Position,Settle));
    const FQuat Rotation=FRotator(Pose.Nod,Pose.Turn,Pose.Tilt).Quaternion();
    // Apply full turns directly; filtering a winding angle creates lag and reversals.
    PosePivot->SetRelativeRotation(FQuat::Slerp(PosePivot->GetRelativeRotation().Quaternion(),Rotation,
        bWinding && TalkBlend<.05f ? 1.f : Settle));
    const float Squash=FMath::Lerp(PosePivot->GetRelativeScale3D().Z-1.f,Pose.Squash,Settle);
    PosePivot->SetRelativeScale3D(FVector(1-Squash*.52f,1-Squash*.52f,1+Squash));

}

FVector ADotPerformer::CameraSubjectLocation() const
{
    return PosePivot->GetComponentLocation();
}

void ADotPerformer::SetTalkFrame(const FDotTalkFrame& Frame)
{
    Talk=Frame;
    TalkAge=0;
}

void ADotPerformer::SetMusicFrame(const FDotMusicFrame& Frame, bool bNewGesture)
{
    Music = Frame;
    MusicSampleAt=FPlatformTime::Seconds();
    bMusicMode = true;
    bPaused = false;
    if (bNewGesture)
    {
        Gesture = Frame.Gesture;
        GestureAge = 0;
    }
}

void ADotPerformer::LeaveMusicMode()
{
    bMusicMode = false;
    TaskLean=0;
    MusicTickAt=0;
}

void ADotPerformer::Cue(EDotMove Move)
{
    LeaveMusicMode();
    ActiveMove = Move;
    Time = 0;
    ManualTravel = 0;
    bPaused = false;
}

void ADotPerformer::SetPaused(bool bNextPaused)
{
    bPaused = bNextPaused;
}

void ADotPerformer::MoveAcrossStage(float Direction, float DeltaSeconds)
{
    ManualTravel = FMath::Clamp(ManualTravel + 130 * DeltaSeconds * Direction, -115, 115);
}

void ADotPerformer::SetHeadphonesVisible(bool bVisible)
{
    Headphones->SetVisibility(bVisible);
}

bool ADotPerformer::HasHeadphones() const
{
    return Headphones->IsVisible();
}

bool ADotPerformer::HasMeshes() const
{
    return IsValid(Body->GetStaticMesh()) && IsValid(Headphones->GetStaticMesh());
}
